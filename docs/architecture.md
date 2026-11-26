# System Architecture — VoltPark City

## 1. Layered Modular Design

```
Next.js App Router UI (src/app/**, src/components/**)
        │  REST JSON + SSE (/api/v1/**)
        ▼
Route Handlers (src/app/api/v1/**) — Thin HTTP/Zod/Auth Boundary
        │
        ▼
Domain Services (src/features/**)
  ├── search/        Geospatial bounds, Haversine/PostGIS, clustering, EV trip & heatmap
  ├── availability/  Window overlap filtering, lazy hold expiry, operator status toggles
  ├── pricing/       Integer-paise tariffs, peak/weekend, daily caps, GST, promos
  ├── reservations/  Atomic hold (FOR UPDATE), extensions, cancellations, QR check-in/out
  ├── payments/      Razorpay sandbox orders, HMAC verification, webhook idempotency, refunds
  ├── charging/      EvChargerProviderAdapter + InternalSimulatedChargeProvider
  ├── operator/      Ownership-scoped inventory & persisted revenue analytics
  └── admin/         Facility approvals, platform fee policies, disputes, audit logs
        │
        ▼
Data & Infrastructure Layer (src/db/**, src/lib/**)
  ├── Drizzle ORM + Schema (28 PostgreSQL tables, 14 enums)
  ├── PGlite (embedded PostgreSQL WASM locally) / node-postgres + PostGIS 3.4 (prod)
  └── SSE Event Bus + HMAC QR Signer + Audit Logger
```

## 2. Concurrency & Double-Booking Prevention

Booking overlaps are prevented at **two layers**:
1. **Application Transaction Serialization (`src/features/reservations/reservations.service.ts`)**:
   - Stale holds past `holdExpiresAt` are expired lazily before availability and hold creation.
   - Inside `db.transaction`, the target `parking_spaces` or `connectors` row is locked via `SELECT ... FOR UPDATE`.
   - Overlaps against active states (`PENDING_PAYMENT`, `CONFIRMED`, `CHECKED_IN`, `ACTIVE`) are checked inside the lock using `(existing.startTime < requestedEnd AND existing.endTime > requestedStart)`.
   - Authoritative server pricing is computed prior to opening the serialized lock so no secondary connection pool contention occurs.
2. **PostgreSQL Production Exclusion Constraints (`src/db/migrations/0002_postgis_prod.sql`)**:
   - Uses `btree_gist` `EXCLUDE USING gist` on `tstzrange(start_time, end_time)` for non-cancelled/non-expired bookings on both `parking_space_id` and `connector_id`.

## 3. Payment Verification, Idempotency & Recovery

- **No Client Price Trust**: The client passes facility, time window, bay/connector, and promo code; the server calculates all integer minor-unit (`paise`) charges and stores a frozen `price_breakdown` JSON snapshot.
- **Order Idempotency**: `createPaymentOrder` deduplicates by `idempotency_key` per reservation.
- **Webhook Idempotency & Signature Verification**: `processGatewayWebhook` verifies `x-razorpay-signature` with `crypto.timingSafeEqual` and records `gateway_event_id` in `webhook_events` to guarantee at-most-once processing.
- **Post-Expiry Recovery**: If a payment settles after a hold's 10-minute TTL elapsed, `verifyAndCapturePayment` checks if the bay is still uncontested. If free, it reacquires and confirms the booking; if taken, it records a `PROCESSED` automatic full refund.

## 4. Real-Time SSE Pipeline & Fallback

- State changes (`RESERVATION_HOLD_CREATED`, `RESERVATION_CONFIRMED`, `OPERATOR_SPACE_UPDATED`, `EV_SESSION_TICK`, `FACILITY_REVIEWED`) emit typed events onto the server event bus (`src/lib/events.ts`), fanned out to connected browsers via `GET /api/v1/events/stream`.
- For multi-instance horizontal scaling in production, `docker-compose.yml` provisions **Redis 7**, allowing the in-memory `EventEmitter` in `src/lib/events.ts` to be swapped cleanly for Redis Pub/Sub.

## 5. Honest Data & Hardware Disclosures

- **Maps**: Uses an interactive coordinate-projected SVG city map with bounding-box filtering, clustering, and heatmap toggle when `NEXT_PUBLIC_MAPBOX_TOKEN` / Google Maps keys are absent, so core flows work deterministically without external keys.
- **EV Chargers**: Backed by `EvChargerProviderAdapter` and `InternalSimulatedChargeProvider`; every session carries `isSimulated = true` until real OCPP 1.6J/2.0.1 WebSocket gateway credentials are configured.
- **Facility Feeds**: Each facility explicitly discloses `OPERATOR_MANAGED` vs `SIMULATED` data source status.
