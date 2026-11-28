import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { AppDb } from "./index";
import {
  users,
  operators,
  operatorStaff,
  evOwnerVerifications,
  facilities,
  facilityHours,
  parkingZones,
  parkingSpaces,
  pricingRules,
  chargingStations,
  connectors,
} from "./schema";

export const DEMO_EV_OWNER_EMAIL = "demo.owner@parksmart.demo";
export const DEMO_EV_OWNER_PASSWORD = "DemoOwner@123";
export const DEMO_EV_HUB_SLUG = "demo-parksmart-ev-hub-ludhiana";

export async function ensureDemoEvOwnerAccount(db: AppDb): Promise<{
  userId: string;
  operatorId: string;
  facilityId: string;
}> {
  let [demoUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEMO_EV_OWNER_EMAIL))
    .limit(1);

  if (!demoUser) {
    const passwordHash = bcrypt.hashSync(DEMO_EV_OWNER_PASSWORD, 10);
    const [inserted] = await db
      .insert(users)
      .values({
        email: DEMO_EV_OWNER_EMAIL,
        passwordHash,
        fullName: "ParkSmart Demo EV Owner",
        phone: "+91-98000-11223",
        role: "EV_OPERATOR",
        emailVerified: true,
        phoneVerified: true,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      demoUser = inserted;
    } else {
      [demoUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, DEMO_EV_OWNER_EMAIL))
        .limit(1);
    }
  }

  if (!demoUser) {
    throw new Error("Failed to resolve demo EV owner user");
  }

  let [demoOp] = await db
    .select()
    .from(operators)
    .where(eq(operators.ownerUserId, demoUser.id))
    .limit(1);

  if (!demoOp) {
    const [createdOp] = await db
      .insert(operators)
      .values({
        ownerUserId: demoUser.id,
        businessName: "ParkSmart Demo EV Superhub",
        registrationNumber: "DEMO-EV-OP-001",
        operatorType: "EV_CHARGING",
        contactEmail: DEMO_EV_OWNER_EMAIL,
        contactPhone: "+91-98000-11223",
        status: "APPROVED",
        verifiedAt: new Date(),
        notes: "Built-in demo EV pump owner profile for live presentation & pre-order sync.",
      })
      .returning();
    demoOp = createdOp;
  }

  if (!demoOp) {
    throw new Error("Failed to resolve demo EV operator");
  }

  await db
    .insert(operatorStaff)
    .values({
      operatorId: demoOp.id,
      userId: demoUser.id,
      staffRole: "MANAGER",
      canManageInventory: true,
      canCheckIn: true,
      canEditPricing: true,
      isActive: true,
    })
    .onConflictDoNothing();

  const [existingVerif] = await db
    .select()
    .from(evOwnerVerifications)
    .where(eq(evOwnerVerifications.operatorId, demoOp.id))
    .limit(1);

  if (!existingVerif) {
    await db
      .insert(evOwnerVerifications)
      .values({
        operatorId: demoOp.id,
        userId: demoUser.id,
        ownerName: "ParkSmart Demo EV Owner",
        businessType: "PRIVATE_LIMITED",
        panNumber: "DEMOP1234K",
        gstinNumber: null,
        businessDocName: "Demo Presentation Profile (No Physical KYC Required)",
        businessDocRef: "demo://presentation-profile",
        siteAddress: "Demo Campus EV Hub, Ferozepur Road, Ludhiana",
        siteCity: "Ludhiana",
        ownershipType: "OWNED",
        propertyDocName: "Demo Hub Location Record",
        propertyDocRef: "demo://site-record",
        nocDocName: "Demo Safety Checklist",
        nocDocRef: "demo://safety-checklist",
        electricityBoard: "PSPCL (Demo Profile)",
        electricityConsumerNo: "DEMO-PSPCL-001",
        sanctionedLoadKw: 250,
        chargerManufacturer: "ParkSmart Demo OCPP",
        chargerModel: "FastCharge-DC120",
        chargerSerialNumber: "DEMO-SER-001",
        connectorType: "CCS2",
        complianceStandard: "OCPP 2.0.1 / Bharat EV",
        chargerDocName: "Demo Charger Profile",
        chargerDocRef: "demo://charger-profile",
        verificationStatus: "APPROVED",
        reviewNotes: "Pre-approved built-in demo EV pump account for testing & live demonstration.",
        reviewedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  let [demoFac] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.slug, DEMO_EV_HUB_SLUG))
    .limit(1);

  if (!demoFac) {
    const [createdFac] = await db
      .insert(facilities)
      .values({
        operatorId: demoOp.id,
        slug: DEMO_EV_HUB_SLUG,
        name: "ParkSmart Demo EV Superhub (Demo)",
        description:
          "Built-in demonstration EV charging hub for live pre-order booking, QR gate check-in, and real-time EV owner dashboard sync.",
        facilityType: "DEDICATED_EV_HUB",
        status: "ACTIVE",
        dataSourceType: "SIMULATED",
        addressLine1: "Demo Campus EV Hub, Ferozepur Road",
        landmark: "Presentation & Simulation Hub",
        city: "Ludhiana",
        state: "Punjab",
        postalCode: "141012",
        latitude: 30.8927,
        longitude: 75.8185,
        is24Hours: true,
        isCovered: true,
        hasSecurity: true,
        hasAccessibility: true,
        hasEvCharging: true,
        totalCapacity: 4,
        supportPhone: "+91-98000-11223",
        amenities: ["120kW CCS2 Fast Charge", "QR Gate Pre-Order", "Live SSE Sync", "24x7 Demo"],
        photos: ["/images/facility-evhub.svg"],
      })
      .onConflictDoNothing()
      .returning();

    if (createdFac) {
      demoFac = createdFac;
    } else {
      [demoFac] = await db
        .select()
        .from(facilities)
        .where(eq(facilities.slug, DEMO_EV_HUB_SLUG))
        .limit(1);
    }

    if (demoFac) {
      const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
        facilityId: demoFac!.id,
        dayOfWeek,
        openTime: "00:00",
        closeTime: "23:59",
        isClosed: false,
      }));
      await db.insert(facilityHours).values(hours).onConflictDoNothing();

      const [zone] = await db
        .insert(parkingZones)
        .values({
          facilityId: demoFac.id,
          name: "Demo EV Fast Charging Deck",
          level: "Ground",
          isCovered: true,
          supportsIndividualSpaces: true,
          aggregateCapacity: 4,
          aggregateAvailable: 4,
        })
        .returning();

      const insertedSpaces = zone
        ? await db
            .insert(parkingSpaces)
            .values([1, 2, 3, 4].map((num) => ({
              facilityId: demoFac!.id,
              zoneId: zone.id,
              code: `EV-0${num}`,
              category: "EV_COMPATIBLE" as const,
              status: "AVAILABLE" as const,
              isEvCompatible: true,
              isAccessible: num === 4,
              isActive: true,
            })))
            .onConflictDoNothing()
            .returning()
        : [];

      await db.insert(pricingRules).values({
        facilityId: demoFac.id,
        name: "Demo EV Hub Standard Tariff",
        spaceCategory: null,
        currency: "INR",
        hourlyRatePaise: 4000,
        dailyMaxPaise: 24000,
        overnightRatePaise: 12000,
        minBillableMinutes: 30,
        gracePeriodMinutes: 15,
        peakMultiplierBps: 10000,
        weekendMultiplierBps: 10000,
        peakStartHour: 10,
        peakEndHour: 20,
        taxBps: 1800,
        isActive: true,
        priority: 5,
      });

      const [station] = await db
        .insert(chargingStations)
        .values({
          facilityId: demoFac.id,
          operatorId: demoOp.id,
          name: "ParkSmart Demo EV Pump Bank #1",
          ocppIdentity: "DEMO-OCPP-001",
          networkProvider: "ParkSmart Demo Hub",
          isSimulated: true,
          isOnline: true,
          firmwareVersion: "OCPP-2.0.1-DEMO",
        })
        .returning();

      if (station) {
        await db.insert(connectors).values([
          {
            stationId: station.id,
            facilityId: demoFac.id,
            parkingSpaceId: insertedSpaces[0]?.id ?? null,
            connectorNumber: 1,
            standard: "CCS2",
            currentType: "DC",
            maxPowerKw: 120,
            status: "AVAILABLE",
            pricePerKwhPaise: 1800,
            sessionFeePaise: 2500,
            idleFeePerMinPaise: 200,
          },
          {
            stationId: station.id,
            facilityId: demoFac.id,
            parkingSpaceId: insertedSpaces[1]?.id ?? null,
            connectorNumber: 2,
            standard: "CCS2",
            currentType: "DC",
            maxPowerKw: 60,
            status: "AVAILABLE",
            pricePerKwhPaise: 1600,
            sessionFeePaise: 2000,
            idleFeePerMinPaise: 200,
          },
          {
            stationId: station.id,
            facilityId: demoFac.id,
            parkingSpaceId: insertedSpaces[2]?.id ?? null,
            connectorNumber: 3,
            standard: "TYPE2_AC",
            currentType: "AC",
            maxPowerKw: 22,
            status: "AVAILABLE",
            pricePerKwhPaise: 1200,
            sessionFeePaise: 1500,
            idleFeePerMinPaise: 100,
          },
        ]);
      }
    }
  }

  if (!demoFac) {
    throw new Error("Failed to resolve demo EV hub facility");
  }

  return {
    userId: demoUser.id,
    operatorId: demoOp.id,
    facilityId: demoFac.id,
  };
}
