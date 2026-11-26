CREATE TABLE IF NOT EXISTS ev_owner_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL UNIQUE REFERENCES operators(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 1. Owner verification
  owner_name varchar(160) NOT NULL,
  business_type varchar(40) NOT NULL,
  pan_number varchar(16) NOT NULL,
  gstin_number varchar(20),
  business_doc_name varchar(255) NOT NULL,
  business_doc_ref text NOT NULL,

  -- 2. Location & ownership proof
  site_address text NOT NULL,
  site_city varchar(120) NOT NULL,
  ownership_type varchar(40) NOT NULL,
  property_doc_name varchar(255) NOT NULL,
  property_doc_ref text NOT NULL,
  noc_doc_name varchar(255) NOT NULL,
  noc_doc_ref text NOT NULL,
  electricity_board varchar(160) NOT NULL,
  electricity_consumer_no varchar(80) NOT NULL,
  sanctioned_load_kw double precision NOT NULL,

  -- 3. Charger verification
  charger_manufacturer varchar(120) NOT NULL,
  charger_model varchar(120) NOT NULL,
  charger_serial_number varchar(120) NOT NULL,
  connector_type connector_standard NOT NULL DEFAULT 'CCS2',
  compliance_standard varchar(160) NOT NULL,
  charger_doc_name varchar(255) NOT NULL,
  charger_doc_ref text NOT NULL,

  verification_status varchar(32) NOT NULL DEFAULT 'PENDING',
  review_notes text,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ev_owner_verif_user_idx ON ev_owner_verifications(user_id);
CREATE INDEX IF NOT EXISTS ev_owner_verif_status_idx ON ev_owner_verifications(verification_status);
