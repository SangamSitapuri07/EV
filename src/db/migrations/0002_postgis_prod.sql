-- Production PostgreSQL + PostGIS Spatial & Concurrency Migration (0002)
-- Applied automatically when ENABLE_POSTGIS=true on PostgreSQL + PostGIS instances.
-- Note: Embedded PGlite dev mode skips PostGIS C-extensions and uses B-tree geo + transactional row locks.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED;

CREATE INDEX IF NOT EXISTS facilities_location_gist_idx
  ON facilities USING GIST (location);

-- Database-level exclusion constraint preventing overlapping active/confirmed/held bookings
-- for the same parking space or connector.
DO $$ BEGIN
  ALTER TABLE reservations
    ADD CONSTRAINT reservations_no_space_overlap
    EXCLUDE USING gist (
      parking_space_id WITH =,
      tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (
      parking_space_id IS NOT NULL
      AND status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE reservations
    ADD CONSTRAINT reservations_no_connector_overlap
    EXCLUDE USING gist (
      connector_id WITH =,
      tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (
      connector_id IS NOT NULL
      AND status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
