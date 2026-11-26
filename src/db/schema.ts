import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

// ============================================================================
// ENUMS
// ============================================================================

export const userRoleEnum = pgEnum("user_role", [
  "CUSTOMER",
  "PARKING_OPERATOR",
  "EV_OPERATOR",
  "SUPER_ADMIN",
]);

export const operatorStatusEnum = pgEnum("operator_status", [
  "PENDING_VERIFICATION",
  "APPROVED",
  "SUSPENDED",
  "REJECTED",
]);

export const facilityStatusEnum = pgEnum("facility_status", [
  "DRAFT",
  "PENDING_APPROVAL",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
]);

export const facilityTypeEnum = pgEnum("facility_type", [
  "MULTI_LEVEL_GARAGE",
  "SURFACE_LOT",
  "UNDERGROUND",
  "STREET_HUB",
  "DEDICATED_EV_HUB",
  "MALL_COMMERCIAL",
]);

export const dataSourceTrustEnum = pgEnum("data_source_trust", [
  "VERIFIED_REAL",
  "OPERATOR_MANAGED",
  "SIMULATED",
]);

export const spaceStatusEnum = pgEnum("space_status", [
  "AVAILABLE",
  "HELD",
  "RESERVED",
  "OCCUPIED",
  "OUT_OF_SERVICE",
]);

export const spaceCategoryEnum = pgEnum("space_category", [
  "STANDARD",
  "COMPACT",
  "SUV",
  "TWO_WHEELER",
  "ACCESSIBLE",
  "EV_COMPATIBLE",
  "VIP_RESERVED",
]);

export const connectorStandardEnum = pgEnum("connector_standard", [
  "CCS2",
  "TYPE2_AC",
  "CHADEMO",
  "BHARAT_DC001",
  "BHARAT_AC001",
  "GB_T",
]);

export const connectorStatusEnum = pgEnum("connector_status", [
  "AVAILABLE",
  "HELD",
  "RESERVED",
  "CHARGING",
  "FAULTED",
  "OFFLINE",
]);

export const reservationStatusEnum = pgEnum("reservation_status", [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CHECKED_IN",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "PAYMENT_FAILED",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "RECONCILED_MANUAL",
]);

export const refundStatusEnum = pgEnum("refund_status", [
  "PENDING",
  "PROCESSED",
  "FAILED",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "ACTIVE",
  "COMPLETED",
  "INTERRUPTED",
  "DISPUTED",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "OPEN",
  "IN_REVIEW",
  "RESOLVED",
  "ESCALATED",
  "CLOSED",
]);

// ============================================================================
// 1. USERS, PROFILES & VEHICLES
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    role: userRoleEnum("role").notNull().default("CUSTOMER"),
    emailVerified: boolean("email_verified").notNull().default(false),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    verificationToken: varchar("verification_token", { length: 128 }),
    resetToken: varchar("reset_token", { length: 128 }),
    resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)]
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("oauth_provider_account_idx").on(t.provider, t.providerAccountId),
    index("oauth_user_idx").on(t.userId),
  ]
);

export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  preferredCity: varchar("preferred_city", { length: 120 }).default("Ludhiana"),
  preferredConnector: connectorStandardEnum("preferred_connector"),
  accessibilityRequired: boolean("accessibility_required").default(false).notNull(),
  notifyEmail: boolean("notify_email").default(true).notNull(),
  notifyPush: boolean("notify_push").default(true).notNull(),
  locationConsentGranted: boolean("location_consent_granted").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nickname: varchar("nickname", { length: 100 }).notNull(),
    registrationNumber: varchar("registration_number", { length: 32 }).notNull(),
    make: varchar("make", { length: 80 }).notNull(),
    model: varchar("model", { length: 80 }).notNull(),
    vehicleCategory: spaceCategoryEnum("vehicle_category").notNull().default("STANDARD"),
    isElectric: boolean("is_electric").notNull().default(false),
    batteryCapacityKwh: doublePrecision("battery_capacity_kwh"),
    supportedConnector: connectorStandardEnum("supported_connector"),
    maxAcKw: doublePrecision("max_ac_kw"),
    maxDcKw: doublePrecision("max_dc_kw"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("vehicles_user_idx").on(t.userId)]
);

// ============================================================================
// 2. OPERATORS & STAFF
// ============================================================================

export const operators = pgTable(
  "operators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    businessName: varchar("business_name", { length: 180 }).notNull(),
    registrationNumber: varchar("registration_number", { length: 100 }).notNull(),
    gstNumber: varchar("gst_number", { length: 32 }),
    operatorType: varchar("operator_type", { length: 40 }).notNull().default("HYBRID"), // PARKING | EV_CHARGING | HYBRID
    contactEmail: varchar("contact_email", { length: 255 }).notNull(),
    contactPhone: varchar("contact_phone", { length: 32 }).notNull(),
    status: operatorStatusEnum("status").notNull().default("PENDING_VERIFICATION"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("operators_owner_idx").on(t.ownerUserId)]
);

export const evOwnerVerifications = pgTable(
  "ev_owner_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operatorId: uuid("operator_id")
      .notNull()
      .unique()
      .references(() => operators.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // 1. Owner verification
    ownerName: varchar("owner_name", { length: 160 }).notNull(),
    businessType: varchar("business_type", { length: 40 }).notNull(),
    panNumber: varchar("pan_number", { length: 16 }).notNull(),
    gstinNumber: varchar("gstin_number", { length: 20 }),
    businessDocName: varchar("business_doc_name", { length: 255 }).notNull(),
    businessDocRef: text("business_doc_ref").notNull(),

    // 2. Location & ownership proof
    siteAddress: text("site_address").notNull(),
    siteCity: varchar("site_city", { length: 120 }).notNull(),
    ownershipType: varchar("ownership_type", { length: 40 }).notNull(),
    propertyDocName: varchar("property_doc_name", { length: 255 }).notNull(),
    propertyDocRef: text("property_doc_ref").notNull(),
    nocDocName: varchar("noc_doc_name", { length: 255 }).notNull(),
    nocDocRef: text("noc_doc_ref").notNull(),
    electricityBoard: varchar("electricity_board", { length: 160 }).notNull(),
    electricityConsumerNo: varchar("electricity_consumer_no", { length: 80 }).notNull(),
    sanctionedLoadKw: doublePrecision("sanctioned_load_kw").notNull(),

    // 3. Charger verification
    chargerManufacturer: varchar("charger_manufacturer", { length: 120 }).notNull(),
    chargerModel: varchar("charger_model", { length: 120 }).notNull(),
    chargerSerialNumber: varchar("charger_serial_number", { length: 120 }).notNull(),
    connectorType: connectorStandardEnum("connector_type").notNull().default("CCS2"),
    complianceStandard: varchar("compliance_standard", { length: 160 }).notNull(),
    chargerDocName: varchar("charger_doc_name", { length: 255 }).notNull(),
    chargerDocRef: text("charger_doc_ref").notNull(),

    verificationStatus: varchar("verification_status", { length: 32 })
      .notNull()
      .default("PENDING"),
    reviewNotes: text("review_notes"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ev_owner_verif_user_idx").on(t.userId),
    index("ev_owner_verif_status_idx").on(t.verificationStatus),
  ]
);

export const operatorStaff = pgTable(
  "operator_staff",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    staffRole: varchar("staff_role", { length: 64 }).notNull().default("ATTENDANT"), // MANAGER | ATTENDANT | TECHNICIAN
    canManageInventory: boolean("can_manage_inventory").notNull().default(true),
    canCheckIn: boolean("can_check_in").notNull().default(true),
    canEditPricing: boolean("can_edit_pricing").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("operator_staff_unique_idx").on(t.operatorId, t.userId)]
);

// ============================================================================
// 3. FACILITIES, HOURS, ZONES & SPACES
// ============================================================================

export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description").notNull(),
    facilityType: facilityTypeEnum("facility_type").notNull(),
    status: facilityStatusEnum("status").notNull().default("PENDING_APPROVAL"),
    dataSourceType: dataSourceTrustEnum("data_source_type").notNull().default("OPERATOR_MANAGED"),
    addressLine1: varchar("address_line1", { length: 255 }).notNull(),
    landmark: varchar("landmark", { length: 180 }),
    city: varchar("city", { length: 100 }).notNull(),
    state: varchar("state", { length: 100 }).notNull(),
    postalCode: varchar("postal_code", { length: 20 }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    is24Hours: boolean("is_24_hours").notNull().default(false),
    isCovered: boolean("is_covered").notNull().default(true),
    hasSecurity: boolean("has_security").notNull().default(true),
    hasAccessibility: boolean("has_accessibility").notNull().default(true),
    hasEvCharging: boolean("has_ev_charging").notNull().default(false),
    totalCapacity: integer("total_capacity").notNull().default(0),
    supportPhone: varchar("support_phone", { length: 32 }),
    cancellationPolicy: text("cancellation_policy")
      .notNull()
      .default("Free cancellation up to 30 minutes before arrival; 50% refund up to start time."),
    amenities: jsonb("amenities").$type<string[]>().notNull().default([]),
    photos: jsonb("photos").$type<string[]>().notNull().default([]),
    availabilityUpdatedAt: timestamp("availability_updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("facilities_slug_idx").on(t.slug),
    index("facilities_geo_idx").on(t.latitude, t.longitude),
    index("facilities_city_status_idx").on(t.city, t.status),
  ]
);

export const facilityHours = pgTable(
  "facility_hours",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 0 = Sun .. 6 = Sat
    openTime: varchar("open_time", { length: 8 }).notNull(), // "06:00"
    closeTime: varchar("close_time", { length: 8 }).notNull(), // "23:00"
    isClosed: boolean("is_closed").notNull().default(false),
  },
  (t) => [uniqueIndex("facility_hours_day_idx").on(t.facilityId, t.dayOfWeek)]
);

export const parkingZones = pgTable(
  "parking_zones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(), // e.g., "Level B1 - EV & Compact"
    level: varchar("level", { length: 40 }).notNull().default("Ground"),
    isCovered: boolean("is_covered").notNull().default(true),
    supportsIndividualSpaces: boolean("supports_individual_spaces").notNull().default(true),
    aggregateCapacity: integer("aggregate_capacity").notNull().default(0),
    aggregateAvailable: integer("aggregate_available").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("parking_zones_facility_idx").on(t.facilityId)]
);

export const parkingSpaces = pgTable(
  "parking_spaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => parkingZones.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(), // e.g. "B1-01"
    category: spaceCategoryEnum("category").notNull().default("STANDARD"),
    status: spaceStatusEnum("status").notNull().default("AVAILABLE"),
    isEvCompatible: boolean("is_ev_compatible").notNull().default(false),
    isAccessible: boolean("is_accessible").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("parking_spaces_code_idx").on(t.facilityId, t.code),
    index("parking_spaces_status_idx").on(t.facilityId, t.status),
  ]
);

// ============================================================================
// 4. EV CHARGING STATIONS & CONNECTORS
// ============================================================================

export const chargingStations = pgTable(
  "charging_stations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    ocppIdentity: varchar("ocpp_identity", { length: 120 }),
    networkProvider: varchar("network_provider", { length: 100 }).notNull().default("INTERNAL_SIMULATED"),
    isSimulated: boolean("is_simulated").notNull().default(true),
    isOnline: boolean("is_online").notNull().default(true),
    firmwareVersion: varchar("firmware_version", { length: 40 }).default("OCPP-2.0.1-SIM"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("charging_stations_facility_idx").on(t.facilityId)]
);

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => chargingStations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    parkingSpaceId: uuid("parking_space_id").references(() => parkingSpaces.id, {
      onDelete: "set null",
    }),
    connectorNumber: integer("connector_number").notNull(),
    standard: connectorStandardEnum("standard").notNull(),
    currentType: varchar("current_type", { length: 10 }).notNull().default("DC"), // AC | DC
    maxPowerKw: doublePrecision("max_power_kw").notNull(),
    status: connectorStatusEnum("status").notNull().default("AVAILABLE"),
    pricePerKwhPaise: integer("price_per_kwh_paise").notNull().default(1800), // INR 18.00/kWh
    sessionFeePaise: integer("session_fee_paise").notNull().default(2500), // INR 25.00
    idleFeePerMinPaise: integer("idle_fee_per_min_paise").notNull().default(200), // INR 2.00/min
    faultReason: text("fault_reason"),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("connectors_station_num_idx").on(t.stationId, t.connectorNumber),
    index("connectors_facility_status_idx").on(t.facilityId, t.status),
  ]
);

// ============================================================================
// 5. PRICING RULES
// ============================================================================

export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 140 }).notNull(),
    spaceCategory: spaceCategoryEnum("space_category"), // null applies to all categories
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    hourlyRatePaise: integer("hourly_rate_paise").notNull(), // e.g., 4000 = INR 40.00/hr
    dailyMaxPaise: integer("daily_max_paise").notNull(), // e.g., 25000 = INR 250.00/day
    overnightRatePaise: integer("overnight_rate_paise"),
    minBillableMinutes: integer("min_billable_minutes").notNull().default(60),
    gracePeriodMinutes: integer("grace_period_minutes").notNull().default(15),
    peakMultiplierBps: integer("peak_multiplier_bps").notNull().default(12500), // 12500 = 1.25x
    weekendMultiplierBps: integer("weekend_multiplier_bps").notNull().default(11500), // 11500 = 1.15x
    peakStartHour: integer("peak_start_hour").notNull().default(9),
    peakEndHour: integer("peak_end_hour").notNull().default(20),
    taxBps: integer("tax_bps").notNull().default(1800), // 18% GST
    isActive: boolean("is_active").notNull().default(true),
    priority: integer("priority").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("pricing_rules_facility_idx").on(t.facilityId, t.isActive)]
);

// ============================================================================
// 6. RESERVATIONS & RESERVATION ITEMS
// ============================================================================

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingReference: varchar("booking_reference", { length: 32 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    parkingSpaceId: uuid("parking_space_id").references(() => parkingSpaces.id, {
      onDelete: "restrict",
    }),
    connectorId: uuid("connector_id").references(() => connectors.id, { onDelete: "restrict" }),
    reservationType: varchar("reservation_type", { length: 32 }).notNull().default("PARKING"), // PARKING | EV_CHARGING | COMBINED
    status: reservationStatusEnum("status").notNull().default("PENDING_PAYMENT"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    estimatedParkingPaise: integer("estimated_parking_paise").notNull().default(0),
    estimatedChargingPaise: integer("estimated_charging_paise").notNull().default(0),
    platformFeePaise: integer("platform_fee_paise").notNull().default(0),
    taxPaise: integer("tax_paise").notNull().default(0),
    discountPaise: integer("discount_paise").notNull().default(0),
    totalEstimatedPaise: integer("total_estimated_paise").notNull(),
    finalAmountPaise: integer("final_amount_paise"),
    priceBreakdown: jsonb("price_breakdown").$type<Record<string, unknown>>().notNull(),
    qrTokenHash: varchar("qr_token_hash", { length: 128 }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("reservations_ref_idx").on(t.bookingReference),
    index("reservations_user_idx").on(t.userId, t.status),
    index("reservations_space_window_idx").on(t.parkingSpaceId, t.startTime, t.endTime),
    index("reservations_connector_window_idx").on(t.connectorId, t.startTime, t.endTime),
  ]
);

export const reservationItems = pgTable(
  "reservation_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    itemType: varchar("item_type", { length: 40 }).notNull(), // PARKING_SPACE | EV_CONNECTOR | EXTENSION | IDLE_FEE
    description: varchar("description", { length: 255 }).notNull(),
    quantity: doublePrecision("quantity").notNull().default(1),
    unitAmountPaise: integer("unit_amount_paise").notNull(),
    totalAmountPaise: integer("total_amount_paise").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("reservation_items_res_idx").on(t.reservationId)]
);

// ============================================================================
// 7. PARKING & EV CHARGING SESSIONS
// ============================================================================

export const parkingSessions = pgTable(
  "parking_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "restrict" }),
    parkingSpaceId: uuid("parking_space_id").references(() => parkingSpaces.id, {
      onDelete: "restrict",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    checkedInByUserId: uuid("checked_in_by_user_id").references(() => users.id),
    status: sessionStatusEnum("status").notNull().default("ACTIVE"),
    entryTime: timestamp("entry_time", { withTimezone: true }).defaultNow().notNull(),
    exitTime: timestamp("exit_time", { withTimezone: true }),
    overstayMinutes: integer("overstay_minutes").notNull().default(0),
    overstayFeePaise: integer("overstay_fee_paise").notNull().default(0),
    reconciledAmountPaise: integer("reconciled_amount_paise"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("parking_sessions_res_idx").on(t.reservationId),
    index("parking_sessions_facility_idx").on(t.facilityId, t.status),
  ]
);

export const chargingSessions = pgTable(
  "charging_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "restrict" }),
    stationId: uuid("station_id")
      .notNull()
      .references(() => chargingStations.id, { onDelete: "restrict" }),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: sessionStatusEnum("status").notNull().default("ACTIVE"),
    isSimulated: boolean("is_simulated").notNull().default(true),
    externalSessionRef: varchar("external_session_ref", { length: 120 }),
    targetKwh: doublePrecision("target_kwh").notNull().default(25),
    energyDeliveredKwh: doublePrecision("energy_delivered_kwh").notNull().default(0),
    averagePowerKw: doublePrecision("average_power_kw").notNull().default(0),
    idleMinutes: integer("idle_minutes").notNull().default(0),
    energyCostPaise: integer("energy_cost_paise").notNull().default(0),
    sessionFeePaise: integer("session_fee_paise").notNull().default(0),
    idleFeePaise: integer("idle_fee_paise").notNull().default(0),
    taxPaise: integer("tax_paise").notNull().default(0),
    totalCostPaise: integer("total_cost_paise").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    telemetryLog: jsonb("telemetry_log")
      .$type<Array<{ ts: string; kw: number; kwh: number; socPct?: number }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("charging_sessions_user_idx").on(t.userId, t.status),
    index("charging_sessions_connector_idx").on(t.connectorId, t.status),
  ]
);

// ============================================================================
// 8. PAYMENTS, ORDERS, REFUNDS & WEBHOOKS
// ============================================================================

export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    gateway: varchar("gateway", { length: 40 }).notNull().default("RAZORPAY_SANDBOX"),
    gatewayOrderId: varchar("gateway_order_id", { length: 128 }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    status: paymentStatusEnum("status").notNull().default("CREATED"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    receiptNumber: varchar("receipt_number", { length: 64 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("payment_orders_gateway_id_idx").on(t.gatewayOrderId),
    index("payment_orders_res_idx").on(t.reservationId),
  ]
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentOrderId: uuid("payment_order_id")
      .notNull()
      .references(() => paymentOrders.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    gatewayPaymentId: varchar("gateway_payment_id", { length: 128 }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    method: varchar("method", { length: 40 }).notNull().default("UPI_SANDBOX"),
    status: paymentStatusEnum("status").notNull().default("CAPTURED"),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("payments_gateway_payment_idx").on(t.gatewayPaymentId),
    index("payments_res_idx").on(t.reservationId),
  ]
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    gatewayRefundId: varchar("gateway_refund_id", { length: 128 }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    reason: text("reason").notNull(),
    status: refundStatusEnum("status").notNull().default("PROCESSED"),
    initiatedByUserId: uuid("initiated_by_user_id").references(() => users.id),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("refunds_gateway_id_idx").on(t.gatewayRefundId),
    index("refunds_res_idx").on(t.reservationId),
  ]
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gateway: varchar("gateway", { length: 40 }).notNull(),
    gatewayEventId: varchar("gateway_event_id", { length: 160 }).notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    signatureValid: boolean("signature_valid").notNull().default(false),
    processed: boolean("processed").notNull().default(false),
    processingResult: text("processing_result"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("webhook_events_gateway_event_idx").on(t.gateway, t.gatewayEventId)]
);

// ============================================================================
// 9. EVENTS, NOTIFICATIONS, REVIEWS, SUPPORT, SAVED, SETTINGS & AUDIT
// ============================================================================

export const availabilityEvents = pgTable(
  "availability_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    resourceType: varchar("resource_type", { length: 32 }).notNull(), // PARKING_SPACE | CONNECTOR | FACILITY
    resourceId: uuid("resource_id").notNull(),
    previousStatus: varchar("previous_status", { length: 40 }),
    newStatus: varchar("new_status", { length: 40 }).notNull(),
    source: varchar("source", { length: 40 }).notNull().default("SYSTEM"), // SYSTEM | OPERATOR | SIMULATOR | OCPP_ADAPTER
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("availability_events_facility_idx").on(t.facilityId, t.occurredAt)]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    body: text("body").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.isRead)]
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    rating: integer("rating").notNull(),
    comment: text("comment").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("reviews_facility_idx").on(t.facilityId)]
);

export const savedFacilities = pgTable(
  "saved_facilities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("saved_facilities_unique_idx").on(t.userId, t.facilityId)]
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "set null" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    category: varchar("category", { length: 64 }).notNull(), // DISPUTE | REFUND | CHARGER_FAULT | ACCESS | OTHER
    subject: varchar("subject", { length: 200 }).notNull(),
    description: text("description").notNull(),
    status: ticketStatusEnum("status").notNull().default("OPEN"),
    resolutionNotes: text("resolution_notes"),
    assignedAdminId: uuid("assigned_admin_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("support_tickets_user_idx").on(t.userId, t.status)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: varchar("actor_role", { length: 40 }),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: varchar("entity_id", { length: 120 }).notNull(),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>(),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
  ]
);

export const platformSettings = pgTable("platform_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 160 }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    route: varchar("route", { length: 160 }).notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("idempotency_key_route_idx").on(t.key, t.route)]
);
