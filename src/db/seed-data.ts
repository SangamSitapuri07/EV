import bcrypt from "bcryptjs";
import { count } from "drizzle-orm";
import type { AppDb } from "./index";
import {
  users,
  userProfiles,
  vehicles,
  operators,
  operatorStaff,
  facilities,
  facilityHours,
  parkingZones,
  parkingSpaces,
  chargingStations,
  connectors,
  pricingRules,
  reservations,
  reservationItems,
  paymentOrders,
  payments,
  reviews,
  notifications,
  supportTickets,
  platformSettings,
  auditLogs,
  availabilityEvents,
} from "./schema";

export async function seedIfEmpty(db: AppDb): Promise<{ seeded: boolean }> {
  const existing = await db.select({ value: count() }).from(users);
  if ((existing[0]?.value ?? 0) > 0) {
    return { seeded: false };
  }

  const hash = (pw: string) => bcrypt.hashSync(pw, 10);

  // 1. Users (Test / Demo accounts only)
  const [customer, parkingOpUser, evOpUser, adminUser, attendantUser] = await db
    .insert(users)
    .values([
      {
        email: "customer@smartmobility.test",
        passwordHash: hash("Customer@123"),
        fullName: "Aarav Sharma",
        phone: "+91-98140-00001",
        role: "CUSTOMER",
        emailVerified: true,
        phoneVerified: true,
      },
      {
        email: "parking.op@smartmobility.test",
        passwordHash: hash("Operator@123"),
        fullName: "Simranjit Gill",
        phone: "+91-98140-00002",
        role: "PARKING_OPERATOR",
        emailVerified: true,
        phoneVerified: true,
      },
      {
        email: "ev.op@smartmobility.test",
        passwordHash: hash("EvOperator@123"),
        fullName: "Vikramaditya Malhotra",
        phone: "+91-98140-00003",
        role: "EV_OPERATOR",
        emailVerified: true,
        phoneVerified: true,
      },
      {
        email: "admin@smartmobility.test",
        passwordHash: hash("Admin@123"),
        fullName: "Priya Nair (Platform Admin)",
        phone: "+91-98140-00004",
        role: "SUPER_ADMIN",
        emailVerified: true,
        phoneVerified: true,
      },
      {
        email: "attendant@smartmobility.test",
        passwordHash: hash("Staff@123"),
        fullName: "Harpreet Singh (Gate Staff)",
        phone: "+91-98140-00005",
        role: "PARKING_OPERATOR",
        emailVerified: true,
        phoneVerified: false,
      },
    ])
    .returning();

  if (!customer || !parkingOpUser || !evOpUser || !adminUser || !attendantUser) {
    throw new Error("Failed to seed base users");
  }

  // Profiles & Vehicles
  await db.insert(userProfiles).values([
    {
      userId: customer.id,
      preferredCity: "Ludhiana",
      preferredConnector: "CCS2",
      accessibilityRequired: false,
      locationConsentGranted: true,
    },
    {
      userId: adminUser.id,
      preferredCity: "Ludhiana",
    },
  ]);

  const [nexonEv, cretaSuv] = await db
    .insert(vehicles)
    .values([
      {
        userId: customer.id,
        nickname: "Nexon EV Max",
        registrationNumber: "PB-10-EV-4021",
        make: "Tata",
        model: "Nexon EV Max",
        vehicleCategory: "EV_COMPATIBLE",
        isElectric: true,
        batteryCapacityKwh: 40.5,
        supportedConnector: "CCS2",
        maxAcKw: 7.2,
        maxDcKw: 50,
        isDefault: true,
      },
      {
        userId: customer.id,
        nickname: "City SUV",
        registrationNumber: "PB-10-AB-8812",
        make: "Hyundai",
        model: "Creta SX",
        vehicleCategory: "SUV",
        isElectric: false,
        isDefault: false,
      },
    ])
    .returning();

  // 2. Operators
  const [metroParkingOp, greenGridEvOp] = await db
    .insert(operators)
    .values([
      {
        ownerUserId: parkingOpUser.id,
        businessName: "MetroPark Smart Infrastructure Pvt Ltd",
        registrationNumber: "CIN-PB-2024-88412",
        gstNumber: "03AABCM1234F1Z5",
        operatorType: "HYBRID",
        contactEmail: "parking.op@smartmobility.test",
        contactPhone: "+91-98140-00002",
        status: "APPROVED",
        verifiedAt: new Date(),
        verifiedByUserId: adminUser.id,
        notes: "Primary urban parking & mall garage partner.",
      },
      {
        ownerUserId: evOpUser.id,
        businessName: "Sutlej VoltCharge Networks",
        registrationNumber: "CIN-PB-2025-19044",
        gstNumber: "03AABCS9876K1Z2",
        operatorType: "EV_CHARGING",
        contactEmail: "ev.op@smartmobility.test",
        contactPhone: "+91-98140-00003",
        status: "APPROVED",
        verifiedAt: new Date(),
        verifiedByUserId: adminUser.id,
        notes: "High-power DC fast charging corridor operator.",
      },
    ])
    .returning();

  if (!metroParkingOp || !greenGridEvOp) {
    throw new Error("Failed to seed operators");
  }

  await db.insert(operatorStaff).values({
    operatorId: metroParkingOp.id,
    userId: attendantUser.id,
    staffRole: "ATTENDANT",
    canManageInventory: true,
    canCheckIn: true,
    canEditPricing: false,
  });

  // 3. Facilities (Ludhiana Smart Mobility Network — Sample / Simulated Data)
  const facilitySeeds = [
    {
      operatorId: metroParkingOp.id,
      slug: "sarabha-nagar-central-plaza",
      name: "Sarabha Nagar Central Plaza & EV Deck",
      description:
        "Covered multi-level smart parking garage in the heart of Sarabha Nagar Main Market with dedicated 60kW CCS2 fast chargers, ANPR gate entry, and accessible ground-level bays.",
      facilityType: "MULTI_LEVEL_GARAGE" as const,
      status: "ACTIVE" as const,
      dataSourceType: "OPERATOR_MANAGED" as const,
      addressLine1: "Plot 14, Main Market Road, Sarabha Nagar",
      landmark: "Near Kipps Market",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141001",
      latitude: 30.8886,
      longitude: 75.8195,
      is24Hours: true,
      isCovered: true,
      hasSecurity: true,
      hasAccessibility: true,
      hasEvCharging: true,
      totalCapacity: 12,
      supportPhone: "+91-161-2450101",
      amenities: ["CCTV 24x7", "Covered Bays", "Elevator", "Restrooms", "Wheelchair Ramp", "QR Gate"],
      photos: ["/images/facility-plaza.svg"],
    },
    {
      operatorId: greenGridEvOp.id,
      slug: "ferozepur-road-volt-superhub",
      name: "Ferozepur Road Volt Superhub",
      description:
        "Dedicated high-speed EV charging and express parking hub along NH-95 Ferozepur Road. Features dual-gun 120kW DC ultra-fast chargers and shaded waiting lounge.",
      facilityType: "DEDICATED_EV_HUB" as const,
      status: "ACTIVE" as const,
      dataSourceType: "SIMULATED" as const,
      addressLine1: "SCO 82-84, Ferozepur Road, Near Westend Mall",
      landmark: "Opposite Pavilion Corridor",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141012",
      latitude: 30.8965,
      longitude: 75.8032,
      is24Hours: true,
      isCovered: true,
      hasSecurity: true,
      hasAccessibility: true,
      hasEvCharging: true,
      totalCapacity: 8,
      supportPhone: "+91-161-2450202",
      amenities: ["120kW DC Fast Charge", "Cafe Lounge", "Wi-Fi", "CCTV 24x7", "Tire Air"],
      photos: ["/images/facility-evhub.svg"],
    },
    {
      operatorId: metroParkingOp.id,
      slug: "model-town-smart-lot",
      name: "Model Town Gol Market Smart Lot",
      description:
        "Open-air smart surface lot with clearly demarcated SUV, compact, and 22kW AC destination charging bays for shopping and dining visits.",
      facilityType: "SURFACE_LOT" as const,
      status: "ACTIVE" as const,
      dataSourceType: "OPERATOR_MANAGED" as const,
      addressLine1: "Block C, Gol Market Square, Model Town",
      landmark: "Near Krishna Mandir",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141002",
      latitude: 30.8832,
      longitude: 75.8404,
      is24Hours: false,
      isCovered: false,
      hasSecurity: true,
      hasAccessibility: true,
      hasEvCharging: true,
      totalCapacity: 10,
      supportPhone: "+91-161-2450303",
      amenities: ["22kW AC Chargers", "Attendant On-Site", "Night Lighting", "Wheelchair Access"],
      photos: ["/images/facility-surface.svg"],
    },
    {
      operatorId: metroParkingOp.id,
      slug: "civil-lines-pavilion-underground",
      name: "Civil Lines Pavilion Underground",
      description:
        "Climate-sheltered underground parking deck serving Pavilion Mall & Civil Lines offices with automated barrier check-in and overnight parking packages.",
      facilityType: "UNDERGROUND" as const,
      status: "ACTIVE" as const,
      dataSourceType: "OPERATOR_MANAGED" as const,
      addressLine1: "Fountain Chowk, Civil Lines",
      landmark: "Adjacent to Rakh Bagh",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141001",
      latitude: 30.9052,
      longitude: 75.8398,
      is24Hours: true,
      isCovered: true,
      hasSecurity: true,
      hasAccessibility: true,
      hasEvCharging: false,
      totalCapacity: 10,
      supportPhone: "+91-161-2450404",
      amenities: ["Underground Cool Bays", "Overnight Safe", "Elevator", "CCTV 24x7"],
      photos: ["/images/facility-underground.svg"],
    },
    {
      operatorId: greenGridEvOp.id,
      slug: "pau-gate-greencharge-corridor",
      name: "PAU Gate-1 GreenCharge Station",
      description:
        "Convenient campus-edge parking and EV charging point with Bharat DC-001 and CCS2 connectors suited for commuters and fleet top-ups.",
      facilityType: "STREET_HUB" as const,
      status: "ACTIVE" as const,
      dataSourceType: "SIMULATED" as const,
      addressLine1: "Ferozepur Road Service Lane, PAU Gate 1",
      landmark: "Punjab Agricultural University Gate 1",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141004",
      latitude: 30.9018,
      longitude: 75.8085,
      is24Hours: false,
      isCovered: false,
      hasSecurity: true,
      hasAccessibility: false,
      hasEvCharging: true,
      totalCapacity: 6,
      supportPhone: "+91-161-2450505",
      amenities: ["CCS2 + Bharat DC", "Quick Top-up", "Solar Canopy"],
      photos: ["/images/facility-evhub.svg"],
    },
    {
      operatorId: metroParkingOp.id,
      slug: "clock-tower-heritage-parkade",
      name: "Clock Tower Heritage Parkade (Pending Review)",
      description:
        "Newly onboarded commercial parkade near Chaura Bazar & Ludhiana Junction awaiting final Super Admin compliance verification.",
      facilityType: "MALL_COMMERCIAL" as const,
      status: "PENDING_APPROVAL" as const,
      dataSourceType: "OPERATOR_MANAGED" as const,
      addressLine1: "GT Road, Near Clock Tower Chowk",
      landmark: "300m from Railway Junction",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141008",
      latitude: 30.9124,
      longitude: 75.8538,
      is24Hours: true,
      isCovered: true,
      hasSecurity: true,
      hasAccessibility: true,
      hasEvCharging: true,
      totalCapacity: 6,
      supportPhone: "+91-161-2450606",
      amenities: ["CCTV 24x7", "Covered Bays", "Near Railway Station"],
      photos: ["/images/facility-plaza.svg"],
    },
  ];

  const insertedFacilities = await db.insert(facilities).values(facilitySeeds).returning();

  // Operating hours for all facilities
  const hourRows: Array<typeof facilityHours.$inferInsert> = [];
  for (const f of insertedFacilities) {
    for (let day = 0; day <= 6; day++) {
      hourRows.push({
        facilityId: f.id,
        dayOfWeek: day,
        openTime: f.is24Hours ? "00:00" : "06:00",
        closeTime: f.is24Hours ? "23:59" : "23:00",
        isClosed: false,
      });
    }
  }
  await db.insert(facilityHours).values(hourRows);

  // Zones, Spaces, Chargers, Connectors, Pricing Rules
  const createdSpacesByFacility: Record<string, Array<{ id: string; code: string; isEv: boolean }>> = {};
  const createdConnectorsByFacility: Record<string, Array<{ id: string }>> = {};

  for (let idx = 0; idx < insertedFacilities.length; idx++) {
    const f = insertedFacilities[idx]!;
    const [zoneA, zoneB] = await db
      .insert(parkingZones)
      .values([
        {
          facilityId: f.id,
          name: f.hasEvCharging ? "Zone A - EV & Priority Deck" : "Zone A - Ground Priority",
          level: f.facilityType === "UNDERGROUND" ? "B1" : "Ground",
          isCovered: f.isCovered,
          supportsIndividualSpaces: true,
          aggregateCapacity: Math.ceil(f.totalCapacity / 2),
          aggregateAvailable: Math.ceil(f.totalCapacity / 2) - 1,
        },
        {
          facilityId: f.id,
          name: "Zone B - Standard & SUV Bays",
          level: f.facilityType === "MULTI_LEVEL_GARAGE" ? "Level 2" : "Surface",
          isCovered: f.isCovered,
          supportsIndividualSpaces: true,
          aggregateCapacity: Math.floor(f.totalCapacity / 2),
          aggregateAvailable: Math.floor(f.totalCapacity / 2),
        },
      ])
      .returning();

    if (!zoneA || !zoneB) continue;

    const spaceRows: Array<typeof parkingSpaces.$inferInsert> = [];
    const half = Math.ceil(f.totalCapacity / 2);
    for (let s = 1; s <= f.totalCapacity; s++) {
      const inZoneA = s <= half;
      const isEv = f.hasEvCharging && s <= 3;
      const isAcc = f.hasAccessibility && s === half;
      const status =
        s === 2 ? ("OCCUPIED" as const) : s === f.totalCapacity && idx === 2 ? ("OUT_OF_SERVICE" as const) : ("AVAILABLE" as const);
      spaceRows.push({
        facilityId: f.id,
        zoneId: inZoneA ? zoneA.id : zoneB.id,
        code: `${inZoneA ? "A" : "B"}-${String(s).padStart(2, "0")}`,
        category: isAcc ? "ACCESSIBLE" : isEv ? "EV_COMPATIBLE" : s % 3 === 0 ? "SUV" : "STANDARD",
        status,
        isEvCompatible: isEv,
        isAccessible: isAcc,
        isActive: true,
      });
    }
    const insertedSpaces = await db.insert(parkingSpaces).values(spaceRows).returning();
    createdSpacesByFacility[f.id] = insertedSpaces.map((sp) => ({
      id: sp.id,
      code: sp.code,
      isEv: sp.isEvCompatible,
    }));

    // Pricing rule per facility
    const baseHourly = idx === 1 ? 5000 : idx === 3 ? 6000 : 4000; // INR 40 - 60/hr
    await db.insert(pricingRules).values([
      {
        facilityId: f.id,
        name: "Standard Hourly & Daily Cap",
        spaceCategory: null,
        currency: "INR",
        hourlyRatePaise: baseHourly,
        dailyMaxPaise: baseHourly * 6,
        overnightRatePaise: Math.round(baseHourly * 3.5),
        minBillableMinutes: 60,
        gracePeriodMinutes: 15,
        peakMultiplierBps: 12000,
        weekendMultiplierBps: 11000,
        peakStartHour: 10,
        peakEndHour: 20,
        taxBps: 1800,
        isActive: true,
        priority: 1,
      },
      {
        facilityId: f.id,
        name: "EV Bay Priority Tariff",
        spaceCategory: "EV_COMPATIBLE",
        currency: "INR",
        hourlyRatePaise: baseHourly + 1000,
        dailyMaxPaise: (baseHourly + 1000) * 6,
        overnightRatePaise: (baseHourly + 1000) * 3,
        minBillableMinutes: 30,
        gracePeriodMinutes: 15,
        peakMultiplierBps: 11500,
        weekendMultiplierBps: 10500,
        peakStartHour: 10,
        peakEndHour: 20,
        taxBps: 1800,
        isActive: true,
        priority: 5,
      },
    ]);

    // Charging stations & connectors if hasEvCharging
    if (f.hasEvCharging) {
      const [station] = await db
        .insert(chargingStations)
        .values({
          facilityId: f.id,
          operatorId: f.operatorId,
          name: `${f.name.split(" ")[0]} Charger Bank #1`,
          ocppIdentity: `OCPP-LDH-0${idx + 1}`,
          networkProvider: "INTERNAL_SIMULATED",
          isSimulated: true,
          isOnline: true,
          firmwareVersion: "OCPP-2.0.1-SIM",
        })
        .returning();

      if (station) {
        const spaces = createdSpacesByFacility[f.id] ?? [];
        const connectorRows: Array<typeof connectors.$inferInsert> = [
          {
            stationId: station.id,
            facilityId: f.id,
            parkingSpaceId: spaces[0]?.id ?? null,
            connectorNumber: 1,
            standard: "CCS2",
            currentType: "DC",
            maxPowerKw: idx === 1 ? 120 : 60,
            status: "AVAILABLE",
            pricePerKwhPaise: idx === 1 ? 2100 : 1800,
            sessionFeePaise: 2500,
            idleFeePerMinPaise: 300,
          },
          {
            stationId: station.id,
            facilityId: f.id,
            parkingSpaceId: spaces[1]?.id ?? null,
            connectorNumber: 2,
            standard: "TYPE2_AC",
            currentType: "AC",
            maxPowerKw: 22,
            status: idx === 2 ? "FAULTED" : "AVAILABLE",
            faultReason: idx === 2 ? "Ground fault trip detected by simulator diagnostics" : null,
            pricePerKwhPaise: 1400,
            sessionFeePaise: 1500,
            idleFeePerMinPaise: 150,
          },
        ];

        if (idx === 1 || idx === 4) {
          connectorRows.push({
            stationId: station.id,
            facilityId: f.id,
            parkingSpaceId: spaces[2]?.id ?? null,
            connectorNumber: 3,
            standard: idx === 4 ? "BHARAT_DC001" : "CHADEMO",
            currentType: "DC",
            maxPowerKw: idx === 4 ? 15 : 50,
            status: "AVAILABLE",
            pricePerKwhPaise: 1700,
            sessionFeePaise: 2000,
            idleFeePerMinPaise: 200,
          });
        }

        const insertedConnectors = await db.insert(connectors).values(connectorRows).returning();
        createdConnectorsByFacility[f.id] = insertedConnectors.map((c) => ({ id: c.id }));
      }
    }
  }

  // 4. Platform Settings
  await db.insert(platformSettings).values([
    {
      key: "pricing_policy",
      value: {
        platformFeeBps: 500,
        defaultTaxBps: 1800,
        holdTtlSeconds: 600,
        freeCancellationWindowMinutes: 30,
      },
      updatedByUserId: adminUser.id,
    },
    {
      key: "system_flags",
      value: {
        maintenanceMode: false,
        evSimulatorEnabled: true,
        sandboxPaymentsOnly: true,
      },
      updatedByUserId: adminUser.id,
    },
  ]);

  // 5. Sample Confirmed Upcoming & Completed Reservations for Customer
  const primaryFacility = insertedFacilities[0]!;
  const evHubFacility = insertedFacilities[1]!;
  const primarySpace = createdSpacesByFacility[primaryFacility.id]?.[0];
  const primaryConn = createdConnectorsByFacility[primaryFacility.id]?.[0];

  const now = new Date();
  const upcomingStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const upcomingEnd = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const pastStart = new Date(now.getTime() - 26 * 60 * 60 * 1000);
  const pastEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  if (primarySpace && primaryConn) {
    const [confirmedRes, completedRes] = await db
      .insert(reservations)
      .values([
        {
          bookingReference: "SM-LDH-1001",
          userId: customer.id,
          facilityId: primaryFacility.id,
          vehicleId: nexonEv?.id ?? null,
          parkingSpaceId: primarySpace.id,
          connectorId: primaryConn.id,
          reservationType: "COMBINED",
          status: "CONFIRMED",
          startTime: upcomingStart,
          endTime: upcomingEnd,
          currency: "INR",
          estimatedParkingPaise: 10000,
          estimatedChargingPaise: 20500,
          platformFeePaise: 1525,
          taxPaise: 5765,
          totalEstimatedPaise: 37790,
          priceBreakdown: {
            ruleName: "EV Bay Priority Tariff",
            durationMinutes: 120,
            parkingBasePaise: 10000,
            chargingEstimatePaise: 20500,
            platformFeePaise: 1525,
            taxPaise: 5765,
            totalPaise: 37790,
          },
          qrTokenHash: "seed-confirmed-qr-1001",
        },
        {
          bookingReference: "SM-LDH-0998",
          userId: customer.id,
          facilityId: evHubFacility.id,
          vehicleId: cretaSuv?.id ?? null,
          parkingSpaceId: createdSpacesByFacility[evHubFacility.id]?.[2]?.id ?? null,
          reservationType: "PARKING",
          status: "COMPLETED",
          startTime: pastStart,
          endTime: pastEnd,
          currency: "INR",
          estimatedParkingPaise: 10000,
          estimatedChargingPaise: 0,
          platformFeePaise: 500,
          taxPaise: 1890,
          totalEstimatedPaise: 12390,
          finalAmountPaise: 12390,
          checkedInAt: pastStart,
          checkedOutAt: pastEnd,
          priceBreakdown: {
            ruleName: "Standard Hourly & Daily Cap",
            durationMinutes: 120,
            parkingBasePaise: 10000,
            chargingEstimatePaise: 0,
            platformFeePaise: 500,
            taxPaise: 1890,
            totalPaise: 12390,
          },
        },
      ])
      .returning();

    if (confirmedRes && completedRes) {
      await db.insert(reservationItems).values([
        {
          reservationId: confirmedRes.id,
          itemType: "PARKING_SPACE",
          description: `Space ${primarySpace.code} (2 hours)`,
          quantity: 2,
          unitAmountPaise: 5000,
          totalAmountPaise: 10000,
        },
        {
          reservationId: confirmedRes.id,
          itemType: "EV_CONNECTOR",
          description: "CCS2 DC Fast Charge Estimate (10 kWh + Session Fee)",
          quantity: 1,
          unitAmountPaise: 20500,
          totalAmountPaise: 20500,
        },
      ]);

      const [order1] = await db
        .insert(paymentOrders)
        .values({
          reservationId: confirmedRes.id,
          userId: customer.id,
          gateway: "RAZORPAY_SANDBOX",
          gatewayOrderId: "order_sandbox_seed_1001",
          amountPaise: 37790,
          currency: "INR",
          status: "CAPTURED",
          receiptNumber: "RCPT-SM-1001",
        })
        .returning();

      if (order1) {
        await db.insert(payments).values({
          paymentOrderId: order1.id,
          reservationId: confirmedRes.id,
          gatewayPaymentId: "pay_sandbox_seed_1001",
          amountPaise: 37790,
          currency: "INR",
          method: "UPI_SANDBOX",
          status: "CAPTURED",
          signatureVerified: true,
          capturedAt: new Date(),
        });
      }
    }
  }

  // 6. Reviews, Notifications, Support Ticket, Events & Audit Logs
  await db.insert(reviews).values([
    {
      facilityId: primaryFacility.id,
      userId: customer.id,
      rating: 5,
      comment: "Clean covered bays and the 60kW CCS2 charger hit 52kW peak on my Nexon EV.",
    },
    {
      facilityId: evHubFacility.id,
      userId: customer.id,
      rating: 4,
      comment: "Super fast charging near Westend Mall. Lounge coffee was a nice touch.",
    },
  ]);

  await db.insert(notifications).values([
    {
      userId: customer.id,
      type: "RESERVATION_CONFIRMED",
      title: "Booking SM-LDH-1001 Confirmed",
      body: "Your combined parking + CCS2 EV bay at Sarabha Nagar Central Plaza is ready.",
      isRead: false,
    },
    {
      userId: adminUser.id,
      type: "FACILITY_PENDING_APPROVAL",
      title: "New Facility Awaiting Review",
      body: "Clock Tower Heritage Parkade submitted onboarding details for approval.",
      isRead: false,
    },
  ]);

  await db.insert(supportTickets).values({
    userId: customer.id,
    facilityId: insertedFacilities[2]!.id,
    category: "CHARGER_FAULT",
    subject: "Model Town Type-2 AC Charger #2 showing ground fault",
    description: "Connector #2 displayed fault LED during evening visit; used Connector #1 instead.",
    status: "IN_REVIEW",
  });

  await db.insert(availabilityEvents).values({
    facilityId: primaryFacility.id,
    resourceType: "FACILITY",
    resourceId: primaryFacility.id,
    previousStatus: "INIT",
    newStatus: "AVAILABLE",
    source: "SYSTEM",
  });

  await db.insert(auditLogs).values({
    actorUserId: adminUser.id,
    actorRole: "SUPER_ADMIN",
    action: "SEED_INITIALIZED",
    entityType: "PLATFORM",
    entityId: "system",
    afterState: { facilitiesCount: insertedFacilities.length, mode: "demo_seed" },
  });

  return { seeded: true };
}
