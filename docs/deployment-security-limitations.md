# Deployment, Security Controls & Honest Limitations

## 1. Security Posture

- **Password Hashing**: `bcryptjs` (salt rounds 10) for all accounts; plaintext passwords are never stored or logged.
- **Google OAuth 2.0 + OIDC**: Authorization Code flow with PKCE (`S256`), signed HTTP-only CSRF state cookie (`sm_oauth_state`), Google JWKS ID token signature verification (`iss` & `aud`), verified-email enforcement, and open-redirect path sanitization.
- **Session Cookies**: `jose` HS256 JWT stored in HTTP-only, `SameSite=Lax` cookie (`sm_session`), `Secure` when served over HTTPS.
- **Server-Side RBAC & Resource Ownership**: Every operator and admin route calls `requireRole(...)` and `assertFacilityAccess(...)` on the server; customers can only read/mutate their own reservations, vehicles, and charging sessions.
- **Server-Authoritative Pricing & Monetary Precision**: All currency amounts are stored as integer minor units (`paise` in INR). Client-supplied totals are ignored.
- **Signed Gate QR Passes**: QR payloads embed `reservationId`, `bookingReference`, `issuedAt`, and an HMAC-SHA256 signature verified on the server at check-in.
- **Payment Integrity**: Signature verification uses constant-time `crypto.timingSafeEqual`. Webhooks are deduplicated by `gateway_event_id`.
- **Rate Limiting**: In-memory sliding window rate limiting (`src/lib/utils.ts`) protects `/api/v1/auth/login` and `/api/v1/auth/register`.
- **Audit Trail**: Sensitive mutations (holds, payments, refunds, facility approvals, policy updates, ticket resolutions, check-ins) append immutable records to `audit_logs`.

## 2. Production Deployment Checklist

1. Provision PostgreSQL 16 + PostGIS 3.4 and Redis 7 (see `docker-compose.yml`).
2. Apply `src/db/migrations/0001_init.sql` and `src/db/migrations/0002_postgis_prod.sql` (enables `GEOGRAPHY(Point, 4326)` `GIST` spatial index and `btree_gist` exclusion constraints).
3. Set strong production environment secrets (`AUTH_JWT_SECRET`, `QR_SIGNING_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`).
4. Replace `src/lib/events.ts` single-node `EventEmitter` with a Redis Pub/Sub adapter if running multiple stateless Next.js replicas.
5. Configure HTTPS reverse proxy (Nginx/Caddy/Cloudflare) and scheduled cron/worker to invoke `expireStaleHolds()` even during zero-traffic intervals.

## 3. Known Limitations & Non-Live Integrations

- **Local Embedded Database**: By default `.env.example` uses `pglite://.data/pgdata` (embedded PostgreSQL WASM) with Haversine distance queries; PostGIS `GEOGRAPHY` and `btree_gist` exclusion constraints activate on full PostgreSQL + PostGIS (`0002_postgis_prod.sql`).
- **Map Rendering**: The built-in interactive map (`src/components/map/interactive-city-map.tsx`) uses an offline-safe coordinate-projected vector map with clustering, bounds search, and heatmap overlay so it functions without paid Mapbox/Google Maps API keys. Mapbox/Google Maps tiles can be wired in via `NEXT_PUBLIC_MAPBOX_TOKEN`.
- **Payment Gateway**: Runs in **Sandbox Mode** (`PAYMENT_GATEWAY_MODE=sandbox`) with real server-side HMAC signature & webhook verification, without processing real money.
- **EV Hardware (OCPP)**: Uses `InternalSimulatedChargeProvider` implementing `EvChargerProviderAdapter`. No physical charger hardware is connected; all charging sessions are clearly marked `isSimulated = true`.
- **Playwright Chromium E2E**: E2E specs are authored in `tests/e2e/smoke.spec.ts` for CI environments with Chromium installed; in this sandbox without Chromium binary egress, verification relies on `tsc`, `eslint`, `next build`, Vitest unit & integration tests, and live HTTP server verification.
