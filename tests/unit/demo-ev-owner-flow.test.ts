import { describe, it, expect, beforeEach } from "vitest";
import { resetDbForTests, ensureDatabaseReady } from "@/db";
import { DEMO_EV_OWNER_EMAIL, ensureDemoEvOwnerAccount } from "@/db/demo-ev-owner";
import { POST as demoOwnerLogin } from "@/app/api/v1/auth/demo-owner/route";
import { listEvPumpsWithAvailability } from "@/features/charging/charging.service";
import { getEvPumpsDashboardData } from "@/features/operator/operator.service";
import {
  createReservationHold,
  validateQrAndCheckIn,
  checkOutParkingSession,
} from "@/features/reservations/reservations.service";
import {
  computePaymentSignature,
  createPaymentOrder,
  verifyAndCapturePayment,
} from "@/features/payments/payments.service";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("Demo EV Owner Account & Real-Time Pre-Order Sync", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "pglite://memory";
    await resetDbForTests();
    await ensureDatabaseReady();
  });

  it("seeds demo EV owner idempotently, signs in via /api/v1/auth/demo-owner, and syncs user pre-orders live", async () => {
    const { db } = await ensureDatabaseReady();

    // Idempotent seeding
    const first = await ensureDemoEvOwnerAccount(db);
    const second = await ensureDemoEvOwnerAccount(db);
    expect(second.userId).toBe(first.userId);
    expect(second.facilityId).toBe(first.facilityId);

    // 1-click Demo EV Owner sign-in endpoint works cleanly
    const loginRes = await demoOwnerLogin(
      new Request("http://localhost:3000/api/v1/auth/demo-owner", { method: "POST" })
    );
    expect(loginRes.status).toBe(200);
    const loginJson = await loginRes.json();
    expect(loginJson.ok).toBe(true);
    expect(loginJson.data.user.email).toBe(DEMO_EV_OWNER_EMAIL);
    expect(loginJson.data.user.role).toBe("EV_OPERATOR");
    expect(loginRes.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);

    const [demoOwner] = await db
      .select()
      .from(users)
      .where(eq(users.email, DEMO_EV_OWNER_EMAIL))
      .limit(1);
    expect(demoOwner).toBeDefined();

    // Customer sees the demo EV pump in /api/v1/ev-pumps
    const pumpList = await listEvPumpsWithAvailability();
    const demoPump = pumpList.pumps.find((p) => p.ocppIdentity === "DEMO-OCPP-001");
    expect(demoPump).toBeDefined();
    expect(demoPump!.connectors.length).toBe(3);

    // Customer books a pre-order slot on Gun #1
    const [customer] = await db
      .select()
      .from(users)
      .where(eq(users.email, "customer@smartmobility.test"))
      .limit(1);
    expect(customer).toBeDefined();

    const customerSession = {
      id: customer!.id,
      email: customer!.email,
      fullName: customer!.fullName,
      role: customer!.role,
      emailVerified: customer!.emailVerified,
    };

    const startTime = new Date(Date.now() + 20 * 60_000).toISOString();
    const endTime = new Date(Date.now() + 80 * 60_000).toISOString();
    const gun1 = demoPump!.connectors[0]!;

    const hold = await createReservationHold(customerSession, {
      facilityId: demoPump!.facilityId,
      connectorId: gun1.id,
      startTime,
      endTime,
      estimatedKwh: 20,
    });

    const createdOrder = await createPaymentOrder({
      user: customerSession,
      reservationId: hold.reservation.id,
      idempotencyKey: `demo-sync-${hold.reservation.id}`,
    });
    expect(createdOrder.order).toBeDefined();
    const order = createdOrder.order!;

    const gatewayPaymentId = "pay_sbx_demo_001";
    const gatewaySignature = computePaymentSignature(order.gatewayOrderId, gatewayPaymentId);

    const verified = await verifyAndCapturePayment({
      user: customerSession,
      paymentOrderId: order.id,
      gatewayPaymentId,
      gatewaySignature,
      method: "UPI_SANDBOX",
    });
    expect(verified.reservation?.status).toBe("CONFIRMED");

    // Demo EV Owner immediately sees the new pre-order on /ev-pumps dashboard
    const ownerSession = {
      id: demoOwner!.id,
      email: demoOwner!.email,
      fullName: demoOwner!.fullName,
      role: demoOwner!.role,
      emailVerified: demoOwner!.emailVerified,
    };
    const ownerDash = await getEvPumpsDashboardData(ownerSession);
    expect(ownerDash.facilities.length).toBe(1);
    expect(ownerDash.pumps.length).toBe(1);
    const syncedOrder = ownerDash.preOrders.find(
      (o) => o.bookingReference === hold.reservation.bookingReference
    );
    expect(syncedOrder).toBeDefined();
    expect(syncedOrder!.status).toBe("CONFIRMED");

    // Demo EV Owner checks in & reconciles pre-order
    const checkedIn = await validateQrAndCheckIn({
      actor: ownerSession,
      bookingReference: hold.reservation.bookingReference,
    });
    expect(checkedIn.bookingReference).toBe(hold.reservation.bookingReference);

    const checkedOut = await checkOutParkingSession({
      actor: ownerSession,
      reservationId: hold.reservation.id,
    });
    expect(checkedOut.reservation?.status).toBe("COMPLETED");
  });
});
