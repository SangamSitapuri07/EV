import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { seedIfEmpty } from "@/db/seed-data";
import { facilities, parkingSpaces, connectors, users, auditLogs } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import {
  createReservationHold,
  validateQrAndCheckIn,
  checkOutParkingSession,
  cancelReservation,
} from "@/features/reservations/reservations.service";
import {
  computePaymentSignature,
  computeWebhookSignature,
  createPaymentOrder,
  processGatewayWebhook,
  verifyAndCapturePayment,
} from "@/features/payments/payments.service";
import {
  startChargingSession,
  advanceSimulatedChargingSession,
  stopChargingSession,
  listEvPumpsWithAvailability,
} from "@/features/charging/charging.service";
import { getEvPumpsDashboardData } from "@/features/operator/operator.service";
import { assertFacilityAccess } from "@/lib/permissions";
import { reviewFacilityApproval } from "@/features/admin/admin.service";
import { updateParkingSpaceStatus } from "@/features/availability/availability.service";

describe("Integration: RBAC, Concurrency, Payments, Webhooks & EV Charging", () => {
  let customer: SessionUser;
  let customer2: SessionUser;
  let parkingOp: SessionUser;
  let evOp: SessionUser;
  let admin: SessionUser;
  let plazaId: string;
  let evHubId: string;
  let pendingFacId: string;
  let plazaFreeSpaceId: string;
  let evFreeConnectorId: string;

  beforeAll(async () => {
    const { db } = await ensureDatabaseReady();
    await seedIfEmpty(db);

    const toSession = (u: typeof users.$inferSelect | undefined): SessionUser => {
      if (!u) throw new Error("Missing seeded user");
      return {
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        emailVerified: u.emailVerified,
      };
    };

    const [custRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "customer@smartmobility.test"))
      .limit(1);
    const [attRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "attendant@smartmobility.test"))
      .limit(1);
    const [popRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "parking.op@smartmobility.test"))
      .limit(1);
    const [eopRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "ev.op@smartmobility.test"))
      .limit(1);
    const [admRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "admin@smartmobility.test"))
      .limit(1);

    customer = toSession(custRow);
    customer2 = toSession(attRow);
    parkingOp = toSession(popRow);
    evOp = toSession(eopRow);
    admin = toSession(admRow);

    const [plaza] = await db
      .select()
      .from(facilities)
      .where(eq(facilities.slug, "sarabha-nagar-central-plaza"))
      .limit(1);
    const [evHub] = await db
      .select()
      .from(facilities)
      .where(eq(facilities.slug, "ferozepur-road-volt-superhub"))
      .limit(1);
    const [pending] = await db
      .select()
      .from(facilities)
      .where(eq(facilities.slug, "clock-tower-heritage-parkade"))
      .limit(1);

    if (!plaza || !evHub || !pending) throw new Error("Missing seeded facilities");

    plazaId = plaza.id;
    evHubId = evHub.id;
    pendingFacId = pending.id;

    const spaces = await db
      .select()
      .from(parkingSpaces)
      .where(eq(parkingSpaces.facilityId, plazaId));
    plazaFreeSpaceId = spaces.find((s) => s.status === "AVAILABLE")!.id;

    const conns = await db
      .select()
      .from(connectors)
      .where(eq(connectors.facilityId, evHubId));
    evFreeConnectorId = conns.find((c) => c.status === "AVAILABLE")!.id;
  });

  it("enforces strict RBAC & operator ownership isolation", async () => {
    await expect(assertFacilityAccess(customer, plazaId)).rejects.toThrow();
    await expect(assertFacilityAccess(evOp, plazaId)).rejects.toThrow();
    await expect(assertFacilityAccess(parkingOp, plazaId)).resolves.toBeDefined();
    await expect(assertFacilityAccess(admin, plazaId)).resolves.toBeDefined();
  });

  it("prevents concurrent double-booking of the exact same parking bay", async () => {
    const start = new Date(Date.now() + 24 * 3600_000).toISOString();
    const end = new Date(Date.now() + 26 * 3600_000).toISOString();

    const results = await Promise.allSettled([
      createReservationHold(customer, {
        facilityId: plazaId,
        parkingSpaceId: plazaFreeSpaceId,
        startTime: start,
        endTime: end,
        estimatedKwh: 0,
      }),
      createReservationHold(customer2, {
        facilityId: plazaId,
        parkingSpaceId: plazaFreeSpaceId,
        startTime: start,
        endTime: end,
        estimatedKwh: 0,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const winResult = fulfilled[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createReservationHold>>
    >;
    const winnerUser =
      winResult.value.reservation.userId === customer.id ? customer : customer2;
    await cancelReservation(
      winnerUser,
      winResult.value.reservation.id,
      "Cleanup concurrency test"
    );
  });

  it("completes full lifecycle: Hold -> Idempotent Order -> Signature Verify -> QR Check-In -> Check-Out", async () => {
    const start = new Date(Date.now() + 72 * 3600_000).toISOString();
    const end = new Date(Date.now() + 74 * 3600_000).toISOString();

    const hold = await createReservationHold(customer, {
      facilityId: plazaId,
      parkingSpaceId: plazaFreeSpaceId,
      startTime: start,
      endTime: end,
      estimatedKwh: 0,
    });

    expect(hold.reservation.status).toBe("PENDING_PAYMENT");

    const idemKey = `order-idem-${Date.now()}`;
    const orderResult = await createPaymentOrder({
      user: customer,
      reservationId: hold.reservation.id,
      idempotencyKey: idemKey,
    });
    const orderReplay = await createPaymentOrder({
      user: customer,
      reservationId: hold.reservation.id,
      idempotencyKey: idemKey,
    });
    expect(orderReplay.order!.id).toBe(orderResult.order!.id);

    const fakePayId = `pay_test_${Date.now()}`;
    const sig = computePaymentSignature(orderResult.order!.gatewayOrderId, fakePayId);

    const capture = await verifyAndCapturePayment({
      user: customer,
      paymentOrderId: orderResult.order!.id,
      gatewayPaymentId: fakePayId,
      gatewaySignature: sig,
      method: "UPI_SANDBOX",
    });

    expect(capture.reservation?.status).toBe("CONFIRMED");
    const qrPayload = "qrPayload" in capture ? capture.qrPayload : null;
    expect(qrPayload).toBeTruthy();

    const checkedIn = await validateQrAndCheckIn({
      actor: parkingOp,
      qrToken: qrPayload!,
    });
    expect(checkedIn.bookingReference).toBe(hold.reservation.bookingReference);

    const checkedOut = await checkOutParkingSession({
      actor: parkingOp,
      reservationId: hold.reservation.id,
    });
    expect(checkedOut.reservation?.status).toBe("COMPLETED");
    expect(checkedOut.finalAmountPaise).toBeGreaterThan(0);
  });

  it("rejects tampered payment webhooks and deduplicates repeated webhook events", async () => {
    const payload = JSON.stringify({
      event_id: `evt_test_${Date.now()}`,
      event: "payment.captured",
      payload: {
        order_id: "order_nonexistent",
        payment_id: `pay_wh_${Date.now()}`,
        amount_paise: 5000,
      },
    });

    await expect(
      processGatewayWebhook({
        rawBody: payload,
        signature: "deadbeef_invalid_sig",
      })
    ).rejects.toThrow();

    const validSig = computeWebhookSignature(payload);
    const first = await processGatewayWebhook({
      rawBody: payload,
      signature: validSig,
    });
    expect(first.duplicate).toBe(false);

    const second = await processGatewayWebhook({
      rawBody: payload,
      signature: validSig,
    });
    expect(second.duplicate).toBe(true);
  });

  it("runs simulated EV charging lifecycle (Start -> Telemetry Tick -> Stop)", async () => {
    const started = await startChargingSession(customer, {
      connectorId: evFreeConnectorId,
      targetKwh: 12,
    });

    expect(started.session?.isSimulated).toBe(true);
    expect(started.session?.status).toBe("ACTIVE");

    const ticked = await advanceSimulatedChargingSession({
      user: customer,
      sessionId: started.session!.id,
      kwhIncrement: 6,
    });
    expect(ticked.session?.energyDeliveredKwh).toBe(6.4);

    const stopped = await stopChargingSession({
      user: customer,
      sessionId: started.session!.id,
    });
    expect(stopped?.status).toBe("COMPLETED");
    expect(stopped?.totalCostPaise).toBeGreaterThan(0);
  });

  it("persists admin facility approval and writes immutable audit log entries", async () => {
    const approved = await reviewFacilityApproval({
      admin,
      facilityId: pendingFacId,
      decision: "ACTIVE",
      reason: "Verified fire safety and CCTV compliance",
    });
    expect(approved?.status).toBe("ACTIVE");

    const { db } = await ensureDatabaseReady();
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, pendingFacId));
    expect(logs.some((l) => l.action === "FACILITY_ACTIVE")).toBe(true);

    const updatedSpace = await updateParkingSpaceStatus({
      facilityId: plazaId,
      spaceId: plazaFreeSpaceId,
      status: "OUT_OF_SERVICE",
      source: "OPERATOR",
    });
    expect(updatedSpace?.status).toBe("OUT_OF_SERVICE");

    await updateParkingSpaceStatus({
      facilityId: plazaId,
      spaceId: plazaFreeSpaceId,
      status: "AVAILABLE",
      source: "OPERATOR",
    });
  });

  it("lists EV pumps with window-aware pre-order availability and surfaces pre-orders in EV Pumps Dashboard", async () => {
    const start = new Date(Date.now() + 96 * 3600_000).toISOString();
    const end = new Date(Date.now() + 98 * 3600_000).toISOString();

    const catalogBefore = await listEvPumpsWithAvailability({
      startTime: start,
      endTime: end,
    });
    expect(catalogBefore.pumps.length).toBeGreaterThan(0);

    const targetGun = catalogBefore.pumps
      .flatMap((p) => p.connectors.map((c) => ({ facilityId: p.facilityId, gun: c })))
      .find((x) => x.facilityId === evHubId && x.gun.isAvailableForWindow);
    expect(targetGun).toBeDefined();

    // Customer pre-orders the EV pump connector slot
    const hold = await createReservationHold(customer, {
      facilityId: evHubId,
      connectorId: targetGun!.gun.id,
      startTime: start,
      endTime: end,
      estimatedKwh: 20,
    });

    // Overlapping window now marks that connector unavailable for other users
    const catalogDuring = await listEvPumpsWithAvailability({
      startTime: start,
      endTime: end,
    });
    const gunAfter = catalogDuring.pumps
      .flatMap((p) => p.connectors)
      .find((c) => c.id === targetGun!.gun.id);
    expect(gunAfter?.isAvailableForWindow).toBe(false);

    // EV Operator sees the pre-order in EV Pumps Dashboard
    const evDashboard = await getEvPumpsDashboardData(evOp);
    expect(evDashboard.pumps.length).toBeGreaterThan(0);
    expect(evDashboard.preOrders.some((o) => o.id === hold.reservation.id)).toBe(true);

    // Cleanup hold
    await cancelReservation(customer, hold.reservation.id, "Cleanup EV pump pre-order test");
  });
});
