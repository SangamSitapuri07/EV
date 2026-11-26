-- Smart Parking & EV Charging Finder — Migration 0001
-- Normalized PostgreSQL DDL (compatible with PostgreSQL 15+ and PGlite; gen_random_uuid() is built-in)

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('CUSTOMER', 'PARKING_OPERATOR', 'EV_OPERATOR', 'SUPER_ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE operator_status AS ENUM ('PENDING_VERIFICATION', 'APPROVED', 'SUSPENDED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE facility_status AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE facility_type AS ENUM ('MULTI_LEVEL_GARAGE', 'SURFACE_LOT', 'UNDERGROUND', 'STREET_HUB', 'DEDICATED_EV_HUB', 'MALL_COMMERCIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_source_trust AS ENUM ('VERIFIED_REAL', 'OPERATOR_MANAGED', 'SIMULATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE space_status AS ENUM ('AVAILABLE', 'HELD', 'RESERVED', 'OCCUPIED', 'OUT_OF_SERVICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE space_category AS ENUM ('STANDARD', 'COMPACT', 'SUV', 'TWO_WHEELER', 'ACCESSIBLE', 'EV_COMPATIBLE', 'VIP_RESERVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE connector_standard AS ENUM ('CCS2', 'TYPE2_AC', 'CHADEMO', 'BHARAT_DC001', 'BHARAT_AC001', 'GB_T');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE connector_status AS ENUM ('AVAILABLE', 'HELD', 'RESERVED', 'CHARGING', 'FAULTED', 'OFFLINE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'PAYMENT_FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'RECONCILED_MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE refund_status AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('ACTIVE', 'COMPLETED', 'INTERRUPTED', 'DISPUTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'ESCALATED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. Users & Profiles
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(32),
  role user_role NOT NULL DEFAULT 'CUSTOMER',
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  verification_token VARCHAR(128),
  reset_token VARCHAR(128),
  reset_token_expires_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferred_city VARCHAR(120) DEFAULT 'Ludhiana',
  preferred_connector connector_standard,
  accessibility_required BOOLEAN NOT NULL DEFAULT FALSE,
  notify_email BOOLEAN NOT NULL DEFAULT TRUE,
  notify_push BOOLEAN NOT NULL DEFAULT TRUE,
  location_consent_granted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname VARCHAR(100) NOT NULL,
  registration_number VARCHAR(32) NOT NULL,
  make VARCHAR(80) NOT NULL,
  model VARCHAR(80) NOT NULL,
  vehicle_category space_category NOT NULL DEFAULT 'STANDARD',
  is_electric BOOLEAN NOT NULL DEFAULT FALSE,
  battery_capacity_kwh DOUBLE PRECISION,
  supported_connector connector_standard,
  max_ac_kw DOUBLE PRECISION,
  max_dc_kw DOUBLE PRECISION,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vehicles_user_idx ON vehicles(user_id);

-- 2. Operators & Staff
CREATE TABLE IF NOT EXISTS operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  business_name VARCHAR(180) NOT NULL,
  registration_number VARCHAR(100) NOT NULL,
  gst_number VARCHAR(32),
  operator_type VARCHAR(40) NOT NULL DEFAULT 'HYBRID',
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(32) NOT NULL,
  status operator_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  verified_at TIMESTAMPTZ,
  verified_by_user_id UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operators_owner_idx ON operators(owner_user_id);

CREATE TABLE IF NOT EXISTS operator_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_role VARCHAR(64) NOT NULL DEFAULT 'ATTENDANT',
  can_manage_inventory BOOLEAN NOT NULL DEFAULT TRUE,
  can_check_in BOOLEAN NOT NULL DEFAULT TRUE,
  can_edit_pricing BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS operator_staff_unique_idx ON operator_staff(operator_id, user_id);

-- 3. Facilities, Hours, Zones, Spaces
CREATE TABLE IF NOT EXISTS facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  slug VARCHAR(160) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  facility_type facility_type NOT NULL,
  status facility_status NOT NULL DEFAULT 'PENDING_APPROVAL',
  data_source_type data_source_trust NOT NULL DEFAULT 'OPERATOR_MANAGED',
  address_line1 VARCHAR(255) NOT NULL,
  landmark VARCHAR(180),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  is_24_hours BOOLEAN NOT NULL DEFAULT FALSE,
  is_covered BOOLEAN NOT NULL DEFAULT TRUE,
  has_security BOOLEAN NOT NULL DEFAULT TRUE,
  has_accessibility BOOLEAN NOT NULL DEFAULT TRUE,
  has_ev_charging BOOLEAN NOT NULL DEFAULT FALSE,
  total_capacity INTEGER NOT NULL DEFAULT 0,
  support_phone VARCHAR(32),
  cancellation_policy TEXT NOT NULL DEFAULT 'Free cancellation up to 30 minutes before arrival; 50% refund up to start time.',
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  availability_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS facilities_slug_idx ON facilities(slug);
CREATE INDEX IF NOT EXISTS facilities_geo_idx ON facilities(latitude, longitude);
CREATE INDEX IF NOT EXISTS facilities_city_status_idx ON facilities(city, status);

CREATE TABLE IF NOT EXISTS facility_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  open_time VARCHAR(8) NOT NULL,
  close_time VARCHAR(8) NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS facility_hours_day_idx ON facility_hours(facility_id, day_of_week);

CREATE TABLE IF NOT EXISTS parking_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  level VARCHAR(40) NOT NULL DEFAULT 'Ground',
  is_covered BOOLEAN NOT NULL DEFAULT TRUE,
  supports_individual_spaces BOOLEAN NOT NULL DEFAULT TRUE,
  aggregate_capacity INTEGER NOT NULL DEFAULT 0,
  aggregate_available INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS parking_zones_facility_idx ON parking_zones(facility_id);

CREATE TABLE IF NOT EXISTS parking_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES parking_zones(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  category space_category NOT NULL DEFAULT 'STANDARD',
  status space_status NOT NULL DEFAULT 'AVAILABLE',
  is_ev_compatible BOOLEAN NOT NULL DEFAULT FALSE,
  is_accessible BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS parking_spaces_code_idx ON parking_spaces(facility_id, code);
CREATE INDEX IF NOT EXISTS parking_spaces_status_idx ON parking_spaces(facility_id, status);

-- 4. EV Charging Stations & Connectors
CREATE TABLE IF NOT EXISTS charging_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  ocpp_identity VARCHAR(120),
  network_provider VARCHAR(100) NOT NULL DEFAULT 'INTERNAL_SIMULATED',
  is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
  is_online BOOLEAN NOT NULL DEFAULT TRUE,
  firmware_version VARCHAR(40) DEFAULT 'OCPP-2.0.1-SIM',
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS charging_stations_facility_idx ON charging_stations(facility_id);

CREATE TABLE IF NOT EXISTS connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES charging_stations(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  parking_space_id UUID REFERENCES parking_spaces(id) ON DELETE SET NULL,
  connector_number INTEGER NOT NULL,
  standard connector_standard NOT NULL,
  current_type VARCHAR(10) NOT NULL DEFAULT 'DC',
  max_power_kw DOUBLE PRECISION NOT NULL,
  status connector_status NOT NULL DEFAULT 'AVAILABLE',
  price_per_kwh_paise INTEGER NOT NULL DEFAULT 1800,
  session_fee_paise INTEGER NOT NULL DEFAULT 2500,
  idle_fee_per_min_paise INTEGER NOT NULL DEFAULT 200,
  fault_reason TEXT,
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS connectors_station_num_idx ON connectors(station_id, connector_number);
CREATE INDEX IF NOT EXISTS connectors_facility_status_idx ON connectors(facility_id, status);

-- 5. Pricing Rules
CREATE TABLE IF NOT EXISTS pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name VARCHAR(140) NOT NULL,
  space_category space_category,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  hourly_rate_paise INTEGER NOT NULL,
  daily_max_paise INTEGER NOT NULL,
  overnight_rate_paise INTEGER,
  min_billable_minutes INTEGER NOT NULL DEFAULT 60,
  grace_period_minutes INTEGER NOT NULL DEFAULT 15,
  peak_multiplier_bps INTEGER NOT NULL DEFAULT 12500,
  weekend_multiplier_bps INTEGER NOT NULL DEFAULT 11500,
  peak_start_hour INTEGER NOT NULL DEFAULT 9,
  peak_end_hour INTEGER NOT NULL DEFAULT 20,
  tax_bps INTEGER NOT NULL DEFAULT 1800,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pricing_rules_facility_idx ON pricing_rules(facility_id, is_active);

-- 6. Reservations & Items
CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference VARCHAR(32) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  parking_space_id UUID REFERENCES parking_spaces(id) ON DELETE RESTRICT,
  connector_id UUID REFERENCES connectors(id) ON DELETE RESTRICT,
  reservation_type VARCHAR(32) NOT NULL DEFAULT 'PARKING',
  status reservation_status NOT NULL DEFAULT 'PENDING_PAYMENT',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  hold_expires_at TIMESTAMPTZ,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  estimated_parking_paise INTEGER NOT NULL DEFAULT 0,
  estimated_charging_paise INTEGER NOT NULL DEFAULT 0,
  platform_fee_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  total_estimated_paise INTEGER NOT NULL,
  final_amount_paise INTEGER,
  price_breakdown JSONB NOT NULL,
  qr_token_hash VARCHAR(128),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_reservation_window CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS reservations_ref_idx ON reservations(booking_reference);
CREATE INDEX IF NOT EXISTS reservations_user_idx ON reservations(user_id, status);
CREATE INDEX IF NOT EXISTS reservations_space_window_idx ON reservations(parking_space_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS reservations_connector_window_idx ON reservations(connector_id, start_time, end_time);

CREATE TABLE IF NOT EXISTS reservation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  item_type VARCHAR(40) NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit_amount_paise INTEGER NOT NULL,
  total_amount_paise INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reservation_items_res_idx ON reservation_items(reservation_id);

-- 7. Sessions
CREATE TABLE IF NOT EXISTS parking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  parking_space_id UUID REFERENCES parking_spaces(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  checked_in_by_user_id UUID REFERENCES users(id),
  status session_status NOT NULL DEFAULT 'ACTIVE',
  entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_time TIMESTAMPTZ,
  overstay_minutes INTEGER NOT NULL DEFAULT 0,
  overstay_fee_paise INTEGER NOT NULL DEFAULT 0,
  reconciled_amount_paise INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_res_idx ON parking_sessions(reservation_id);
CREATE INDEX IF NOT EXISTS parking_sessions_facility_idx ON parking_sessions(facility_id, status);

CREATE TABLE IF NOT EXISTS charging_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  station_id UUID NOT NULL REFERENCES charging_stations(id) ON DELETE RESTRICT,
  connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status session_status NOT NULL DEFAULT 'ACTIVE',
  is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
  external_session_ref VARCHAR(120),
  target_kwh DOUBLE PRECISION NOT NULL DEFAULT 25,
  energy_delivered_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_power_kw DOUBLE PRECISION NOT NULL DEFAULT 0,
  idle_minutes INTEGER NOT NULL DEFAULT 0,
  energy_cost_paise INTEGER NOT NULL DEFAULT 0,
  session_fee_paise INTEGER NOT NULL DEFAULT 0,
  idle_fee_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_cost_paise INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  telemetry_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS charging_sessions_user_idx ON charging_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS charging_sessions_connector_idx ON charging_sessions(connector_id, status);

-- 8. Payments, Refunds, Webhooks
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  gateway VARCHAR(40) NOT NULL DEFAULT 'RAZORPAY_SANDBOX',
  gateway_order_id VARCHAR(128) NOT NULL,
  amount_paise INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  status payment_status NOT NULL DEFAULT 'CREATED',
  idempotency_key VARCHAR(128),
  receipt_number VARCHAR(64) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_gateway_id_idx ON payment_orders(gateway_order_id);
CREATE INDEX IF NOT EXISTS payment_orders_res_idx ON payment_orders(reservation_id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE RESTRICT,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  gateway_payment_id VARCHAR(128) NOT NULL,
  amount_paise INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  method VARCHAR(40) NOT NULL DEFAULT 'UPI_SANDBOX',
  status payment_status NOT NULL DEFAULT 'CAPTURED',
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at TIMESTAMPTZ,
  failure_reason TEXT,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_gateway_payment_idx ON payments(gateway_payment_id);
CREATE INDEX IF NOT EXISTS payments_res_idx ON payments(reservation_id);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  gateway_refund_id VARCHAR(128) NOT NULL,
  amount_paise INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  reason TEXT NOT NULL,
  status refund_status NOT NULL DEFAULT 'PROCESSED',
  initiated_by_user_id UUID REFERENCES users(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_gateway_id_idx ON refunds(gateway_refund_id);
CREATE INDEX IF NOT EXISTS refunds_res_idx ON refunds(reservation_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway VARCHAR(40) NOT NULL,
  gateway_event_id VARCHAR(160) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processing_result TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_gateway_event_idx ON webhook_events(gateway, gateway_event_id);

-- 9. Events, Notifications, Reviews, Support, Saved, Settings, Audit
CREATE TABLE IF NOT EXISTS availability_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  resource_type VARCHAR(32) NOT NULL,
  resource_id UUID NOT NULL,
  previous_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS availability_events_facility_idx ON availability_events(facility_id, occurred_at);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_read_idx ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reviews_facility_idx ON reviews(facility_id);

CREATE TABLE IF NOT EXISTS saved_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS saved_facilities_unique_idx ON saved_facilities(user_id, facility_id);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  category VARCHAR(64) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  status ticket_status NOT NULL DEFAULT 'OPEN',
  resolution_notes TEXT,
  assigned_admin_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets(user_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(40),
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(120) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS platform_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by_user_id UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(160) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  route VARCHAR(160) NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_key_route_idx ON idempotency_keys(key, route);
