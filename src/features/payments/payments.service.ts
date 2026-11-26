import crypto from "crypto";
import { and, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import {
  connectors,
  notifications,
  parkingSpaces,
  paymentOrders,
  payments,
  refunds,
  reservations,
  webhookEvents,
} from "@/db/schema";
import { AppError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { type SessionUser, signQrPayload } from "@/lib/auth";
import { publishPlatformEvent } from "@/lib/events";
import { expireStaleHolds } from "@/features/availability/availability.service";

function getGatewaySecret(): string {
  return process.env.RAZORPAY_KEY_SECRET || "rzp_test_sandbox_demo_secret";
}

function getWebhookSecret(): string {
  return process.env.RAZORPAY_WEBHOOK_SECRET || "whsec_test_sandbox_webhook_secret";
}

export function computePaymentSignature(gatewayOrderId: string, gatewayPaymentId: string): string {
  return crypto
    .createHmac("sha256", getGatewaySecret())
    .update(`${gatewayOrderId}|${gatewayPaymentId}`)
    .digest("hex");
}

export function verifyPaymentSignature(
  gatewayOrderId: string,
  gatewayPaymentId: string,
  signature: string
): boolean {
  const expected = computePaymentSignature(gatewayOrderId, gatewayPaymentId);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function computeWebhookSignature(rawBody: string): string {
  return crypto.createHmac("sha256", getWebhookSecret()).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = computeWebhookSignature(rawBody);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function createPaymentOrder(params: {
  user: SessionUser;
  reservationId: string;
  idempotencyKey?: string;
}) {
  await expireStaleHolds();
  const { db } = await ensureDatabaseReady();

  const [reservation] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, params.reservationId))
    .limit(1);

  if (!reservation) {
    throw new AppError(404, "NOT_FOUND", "Reservation not found");
  }
  if (reservation.userId !== params.user.id && params.user.role !== "SUPER_ADMIN") {
    throw new AppError(403, "FORBIDDEN", "Cannot create payment order for another user");
  }
  if (reservation.status === "EXPIRED") {
    throw new AppError(409, "HOLD_EXPIRED", "Reservation hold has expired. Please rebook.");
  }
  if (reservation.status !== "PENDING_PAYMENT" && reservation.status !== "PAYMENT_FAILED") {
    throw new AppError(
      409,
      "INVALID_RESERVATION_STATE",
      `Cannot initiate payment in status ${reservation.status}`
    );
  }

  // Return existing active order if idempotent or already created for current hold
  if (params.idempotencyKey) {
    const [existingOrder] = await db
      .select()
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.reservationId, reservation.id),
          eq(paymentOrders.idempotencyKey, params.idempotencyKey)
        )
      )
      .limit(1);
    if (existingOrder) {
      return {
        order: existingOrder,
        gatewayKeyId: process.env.RAZORPAY_KEY_ID || "rzp_test_sandbox_demo_key",
        mode: process.env.PAYMENT_GATEWAY_MODE || "sandbox",
      };
    }
  }

  const gatewayOrderId = `order_sbx_${crypto.randomBytes(8).toString("hex")}`;
  const receiptNumber = `RCPT-${reservation.bookingReference}-${Date.now().toString().slice(-4)}`;

  const [order] = await db
    .insert(paymentOrders)
    .values({
      reservationId: reservation.id,
      userId: params.user.id,
      gateway: "RAZORPAY_SANDBOX",
      gatewayOrderId,
      amountPaise: reservation.totalEstimatedPaise,
      currency: reservation.currency,
      status: "CREATED",
      idempotencyKey: params.idempotencyKey ?? null,
      receiptNumber,
      metadata: { bookingReference: reservation.bookingReference },
    })
    .returning();

  return {
    order,
    gatewayKeyId: process.env.RAZORPAY_KEY_ID || "rzp_test_sandbox_demo_key",
    mode: process.env.PAYMENT_GATEWAY_MODE || "sandbox",
  };
}

/**
 * Generates a sandbox gateway payment signature ONLY on the server in sandbox test mode
 * when simulating checkout completion, then runs the exact same server-side verification flow.
 */
export async function verifyAndCapturePayment(params: {
  user: SessionUser;
  paymentOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature: string;
  method?: string;
  simulateLateAfterExpiry?: boolean;
}) {
  const { db } = await ensureDatabaseReady();

  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.id, params.paymentOrderId))
    .limit(1);

  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Payment order not found");
  }
  if (order.userId !== params.user.id && params.user.role !== "SUPER_ADMIN") {
    throw new AppError(403, "FORBIDDEN", "Unauthorized payment verification");
  }

  const sigValid = verifyPaymentSignature(
    order.gatewayOrderId,
    params.gatewayPaymentId,
    params.gatewaySignature
  );

  if (!sigValid) {
    await db
      .update(paymentOrders)
      .set({ status: "FAILED", updatedAt: new Date() })
      .where(eq(paymentOrders.id, order.id));
    throw new AppError(400, "INVALID_SIGNATURE", "Payment gateway signature verification failed");
  }

  // Idempotency: if payment already recorded for gatewayPaymentId, return it
  const [alreadyCaptured] = await db
    .select()
    .from(payments)
    .where(eq(payments.gatewayPaymentId, params.gatewayPaymentId))
    .limit(1);

  if (alreadyCaptured) {
    const [res] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, order.reservationId))
      .limit(1);
    return {
      payment: alreadyCaptured,
      reservation: res,
      recoveredFromExpiry: false,
      autoRefunded: false,
    };
  }

  const now = new Date();

  const outcome = await db.transaction(async (tx) => {
    const [res] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, order.reservationId))
      .limit(1);

    if (!res) {
      throw new AppError(404, "RESERVATION_NOT_FOUND", "Linked reservation missing");
    }

    // Check if hold expired before payment arrived
    const holdIsExpired =
      res.status === "EXPIRED" ||
      (res.status === "PENDING_PAYMENT" &&
        res.holdExpiresAt !== null &&
        res.holdExpiresAt < now);

    const [payment] = await tx
      .insert(payments)
      .values({
        paymentOrderId: order.id,
        reservationId: res.id,
        gatewayPaymentId: params.gatewayPaymentId,
        amountPaise: order.amountPaise,
        currency: order.currency,
        method: params.method ?? "UPI_SANDBOX",
        status: "CAPTURED",
        signatureVerified: true,
        capturedAt: now,
      })
      .returning();

    await tx
      .update(paymentOrders)
      .set({ status: "CAPTURED", updatedAt: now })
      .where(eq(paymentOrders.id, order.id));

    if (!holdIsExpired && (res.status === "PENDING_PAYMENT" || res.status === "PAYMENT_FAILED")) {
      const qrToken = signQrPayload({
        reservationId: res.id,
        bookingReference: res.bookingReference,
      });

      const [confirmed] = await tx
        .update(reservations)
        .set({
          status: "CONFIRMED",
          qrTokenHash: crypto.createHash("sha256").update(qrToken).digest("hex"),
          updatedAt: now,
        })
        .where(eq(reservations.id, res.id))
        .returning();

      if (res.parkingSpaceId) {
        await tx
          .update(parkingSpaces)
          .set({ status: "RESERVED", statusUpdatedAt: now })
          .where(eq(parkingSpaces.id, res.parkingSpaceId));
      }
      if (res.connectorId) {
        await tx
          .update(connectors)
          .set({ status: "RESERVED", statusUpdatedAt: now })
          .where(eq(connectors.id, res.connectorId));
      }

      await tx.insert(notifications).values({
        userId: res.userId,
        type: "PAYMENT_CONFIRMED",
        title: `Booking ${res.bookingReference} Confirmed`,
        body: `Payment of INR ${(order.amountPaise / 100).toFixed(2)} verified. Your QR pass is ready.`,
      });

      return {
        payment,
        reservation: confirmed,
        qrPayload: qrToken,
        recoveredFromExpiry: false,
        autoRefunded: false,
      };
    }

    // EDGE CASE RECOVERY: Payment succeeded AFTER hold expired!
    // Check if the resource is still conflict-free for [startTime, endTime)
    let conflictExists = false;
    if (res.parkingSpaceId) {
      const spaceOverlaps = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.parkingSpaceId, res.parkingSpaceId),
            ne(reservations.id, res.id),
            inArray(reservations.status, ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "ACTIVE"]),
            lt(reservations.startTime, res.endTime),
            gt(reservations.endTime, res.startTime)
          )
        )
        .limit(1);
      if (spaceOverlaps.length > 0) conflictExists = true;
    }
    if (!conflictExists && res.connectorId) {
      const connOverlaps = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.connectorId, res.connectorId),
            ne(reservations.id, res.id),
            inArray(reservations.status, ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "ACTIVE"]),
            lt(reservations.startTime, res.endTime),
            gt(reservations.endTime, res.startTime)
          )
        )
        .limit(1);
      if (connOverlaps.length > 0) conflictExists = true;
    }

    if (!conflictExists) {
      // Safe recovery: reacquire resource and confirm reservation!
      const qrToken = signQrPayload({
        reservationId: res.id,
        bookingReference: res.bookingReference,
      });

      const [recovered] = await tx
        .update(reservations)
        .set({
          status: "CONFIRMED",
          qrTokenHash: crypto.createHash("sha256").update(qrToken).digest("hex"),
          updatedAt: now,
        })
        .where(eq(reservations.id, res.id))
        .returning();

      if (res.parkingSpaceId) {
        await tx
          .update(parkingSpaces)
          .set({ status: "RESERVED", statusUpdatedAt: now })
          .where(eq(parkingSpaces.id, res.parkingSpaceId));
      }

      await tx.insert(notifications).values({
        userId: res.userId,
        type: "HOLD_RECOVERED",
        title: `Booking ${res.bookingReference} Recovered & Confirmed`,
        body: "Payment arrived after hold timeout, but your bay was safely reacquired and confirmed.",
      });

      return {
        payment,
        reservation: recovered,
        qrPayload: qrToken,
        recoveredFromExpiry: true,
        autoRefunded: false,
      };
    }

    // Resource was taken by another customer after hold expired -> initiate full automatic refund!
    if (payment) {
      await tx.insert(refunds).values({
        paymentId: payment.id,
        reservationId: res.id,
        gatewayRefundId: `rfnd_auto_${crypto.randomBytes(6).toString("hex")}`,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
        reason: "Automatic refund: payment received after hold expiry and resource was reallocated.",
        status: "PROCESSED",
        processedAt: now,
      });
      await tx
        .update(payments)
        .set({ status: "REFUNDED" })
        .where(eq(payments.id, payment.id));
    }

    const [cancelledRes] = await tx
      .update(reservations)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancellationReason: "Hold expired before payment; slot taken; auto-refund issued.",
        updatedAt: now,
      })
      .where(eq(reservations.id, res.id))
      .returning();

    await tx.insert(notifications).values({
      userId: res.userId,
      type: "AUTO_REFUND_ISSUED",
      title: `Auto-Refund Issued for ${res.bookingReference}`,
      body: "Your hold expired and the slot was booked by another driver. Full refund processed.",
    });

    return {
      payment,
      reservation: cancelledRes,
      qrPayload: null,
      recoveredFromExpiry: false,
      autoRefunded: true,
    };
  });

  await writeAuditLog({
    actorUserId: params.user.id,
    actorRole: params.user.role,
    action: outcome.autoRefunded
      ? "PAYMENT_POST_EXPIRY_AUTO_REFUND"
      : outcome.recoveredFromExpiry
        ? "PAYMENT_POST_EXPIRY_RECOVERED"
        : "PAYMENT_CAPTURED",
    entityType: "PAYMENT_ORDER",
    entityId: order.id,
    afterState: {
      reservationStatus: outcome.reservation?.status,
      autoRefunded: outcome.autoRefunded,
    },
  });

  if (outcome.reservation) {
    publishPlatformEvent({
      type: "RESERVATION_UPDATED",
      facilityId: outcome.reservation.facilityId,
      userId: outcome.reservation.userId,
      source: "PAYMENT_GATEWAY",
      payload: {
        reservationId: outcome.reservation.id,
        status: outcome.reservation.status,
      },
    });
  }

  return outcome;
}

export async function processGatewayWebhook(params: {
  rawBody: string;
  signature: string;
  gateway?: string;
}) {
  const gateway = params.gateway ?? "RAZORPAY_SANDBOX";
  const sigValid = verifyWebhookSignature(params.rawBody, params.signature);

  if (!sigValid) {
    throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "Webhook signature verification failed");
  }

  const parsed = JSON.parse(params.rawBody) as {
    event_id?: string;
    event?: string;
    payload?: {
      order_id?: string;
      payment_id?: string;
      amount_paise?: number;
      reason?: string;
    };
  };

  if (!parsed.event_id || !parsed.event) {
    throw new AppError(400, "INVALID_WEBHOOK_PAYLOAD", "Missing event_id or event");
  }

  const { db } = await ensureDatabaseReady();

  // Duplicate webhook idempotency check
  const [existingEvent] = await db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.gateway, gateway),
        eq(webhookEvents.gatewayEventId, parsed.event_id)
      )
    )
    .limit(1);

  if (existingEvent) {
    return {
      duplicate: true,
      eventId: parsed.event_id,
      processingResult: existingEvent.processingResult,
    };
  }

  const now = new Date();
  let resultNote = "IGNORED";

  if (parsed.event === "payment.captured" && parsed.payload?.order_id && parsed.payload?.payment_id) {
    const [order] = await db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.gatewayOrderId, parsed.payload.order_id))
      .limit(1);

    if (order) {
      const [existingPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.gatewayPaymentId, parsed.payload.payment_id))
        .limit(1);

      if (!existingPayment) {
        await db.insert(payments).values({
          paymentOrderId: order.id,
          reservationId: order.reservationId,
          gatewayPaymentId: parsed.payload.payment_id,
          amountPaise: parsed.payload.amount_paise ?? order.amountPaise,
          currency: order.currency,
          method: "WEBHOOK_CAPTURED",
          status: "CAPTURED",
          signatureVerified: true,
          capturedAt: now,
          rawPayload: parsed as unknown as Record<string, unknown>,
        });
        await db
          .update(paymentOrders)
          .set({ status: "CAPTURED", updatedAt: now })
          .where(eq(paymentOrders.id, order.id));
        await db
          .update(reservations)
          .set({ status: "CONFIRMED", updatedAt: now })
          .where(
            and(
              eq(reservations.id, order.reservationId),
              eq(reservations.status, "PENDING_PAYMENT")
            )
          );
      }
      resultNote = "PAYMENT_CAPTURED_RECONCILED";
    }
  } else if (parsed.event === "payment.failed" && parsed.payload?.order_id) {
    const [order] = await db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.gatewayOrderId, parsed.payload.order_id))
      .limit(1);
    if (order) {
      await db
        .update(paymentOrders)
        .set({ status: "FAILED", updatedAt: now })
        .where(eq(paymentOrders.id, order.id));
      await db
        .update(reservations)
        .set({ status: "PAYMENT_FAILED", updatedAt: now })
        .where(
          and(
            eq(reservations.id, order.reservationId),
            eq(reservations.status, "PENDING_PAYMENT")
          )
        );
      resultNote = "PAYMENT_FAILED_RECORDED";
    }
  }

  await db.insert(webhookEvents).values({
    gateway,
    gatewayEventId: parsed.event_id,
    eventType: parsed.event,
    signatureValid: true,
    processed: true,
    processingResult: resultNote,
    payload: parsed as unknown as Record<string, unknown>,
    processedAt: now,
  });

  return {
    duplicate: false,
    eventId: parsed.event_id,
    processingResult: resultNote,
  };
}

export async function listUserPaymentsAndRefunds(userId: string) {
  const { db } = await ensureDatabaseReady();

  const orders = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.userId, userId))
    .orderBy(desc(paymentOrders.createdAt));

  if (orders.length === 0) return { orders: [], payments: [], refunds: [] };

  const resIds = Array.from(new Set(orders.map((o) => o.reservationId)));

  const [paymentRows, refundRows] = await Promise.all([
    db.select().from(payments).where(inArray(payments.reservationId, resIds)),
    db.select().from(refunds).where(inArray(refunds.reservationId, resIds)),
  ]);

  return { orders, payments: paymentRows, refunds: refundRows };
}
