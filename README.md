# VoltPark City — Smart Parking & EV Charging Finder

A full-stack, modular, multi-role **Smart Parking & EV Charging Finder** built with **Next.js (App Router)**, **React 19**, **TypeScript (strict mode)**, **Tailwind CSS v4**, **Drizzle ORM**, **PostgreSQL (+ PostGIS production support / embedded PGlite local runtime)**, **Server-Sent Events (SSE)**, **Razorpay Sandbox Payment Verification**, and **Vitest + Playwright**.

---

## Core Capabilities

- **Customer Discovery & Booking (`/explore`, `/facilities/[slug]`)**:
  - Geospatial bounding-box & radius search, Haversine / PostGIS distance calculation, clustering map with heatmap toggle, and multi-criteria filtering (EV charging, connector standard `CCS2`/`TYPE2_AC`/`CHADEMO`/`BHARAT_DC001`, minimum kW, hourly price ceiling, facility type, covered, 24/7, accessibility, data source).
  - Real-time availability over **SSE** (`/api/v1/events/stream`).
  - Window-aware availability calculation, atomic space/connector hold with `SELECT ... FOR UPDATE` pessimistic row locks, server-authoritative integer-paise pricing (5% platform fee, 18% GST, daily caps, peak/weekend rules, promo codes), Razorpay sandbox signature verification, and HMAC-SHA256 signed QR gate passes.
- **EV Charging Engine & Trip Planner (`/dashboard`, `/trip-planner`)**:
  - `EvChargerProviderAdapter` interface backed by `InternalSimulatedChargeProvider` (explicitly labeled as simulated OCPP telemetry with `isSimulated = true`).
  - Interactive start, +kWh telemetry tick, and stop reconciliation with 18% GST billing.
  - Rule-based EV Trip Charge Planner and City Occupancy Heatmap.
- **Role-Based Dashboards**:
  - **Customer (`/dashboard`)**: Bookings, QR gate passes, 1-hour extensions, cancellation/refund tracking, EV charging simulator, vehicle garage, payment receipts, notifications, and support tickets.
  - **Parking / EV Operator (`/operator`)**: Ownership-scoped live space/connector toggles (broadcast over SSE), QR gate check-in & overstay check-out reconciliation, persisted utilization & revenue analytics, and new facility onboarding.
  - **Super Admin (`/admin`)**: Facility approval/suspension workflow, operator verification, platform fee/GST/hold-TTL policy settings, support dispute resolution, availability freshness monitor, and immutable audit log viewer.

---

## Tech Stack & Architecture Decisions

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) + React 19 + TypeScript strict | Server Components + 26 REST/SSE route handlers under `/api/v1/**` |
| Styling & UI | Tailwind CSS v4 + Lucide React + custom accessible primitives | Responsive design with clear status badges & data-source disclosures |
| Forms & Validation | React Hook Form + Zod | Shared schema validation across client and API |
| ORM & Database | Drizzle ORM + PostgreSQL (embedded PGlite locally; PostGIS 3.4 in Docker/Prod) | 28 normalized tables, integer paise monetary units, `0001_init.sql` + `0002_postgis_prod.sql` |
| Auth & Security | `bcryptjs` password hashing + `jose` HS256 HTTP-only cookie (`sm_session`) + HMAC QR signing | Server-side RBAC (`CUSTOMER`, `PARKING_OPERATOR`, `EV_OPERATOR`, `SUPER_ADMIN`) |
| Real-time | Server-Sent Events (`/api/v1/events/stream`) | Facility-scoped and global live availability broadcasts |
| Payments | Razorpay Sandbox Adapter | Server-side HMAC-SHA256 order & webhook signature verification, idempotency, post-expiry recovery/auto-refund |
| Testing | Vitest + Playwright | Unit tests, PostgreSQL concurrency/RBAC/webhook integration tests, E2E specs |

> **Database Note**: Prisma CLI engines require downloading external binaries from `binaries.prisma.sh`. To ensure deterministic builds and offline/sandbox compatibility without external binary downloads, this project uses pure-TypeScript **Drizzle ORM** over **PostgreSQL** (`@electric-sql/pglite` locally + `pg` + PostGIS 3.4 in production via `docker-compose.yml`).

---

## Getting Started (Local Development)

### 1. Environment Setup
```bash
cp .env.example .env
```
By default, `DATABASE_URL=pglite://.data/pgdata` runs a persisted embedded PostgreSQL 19 instance locally with zero external dependencies.

To enable **Sign in with Google**, create an OAuth 2.0 Web Client in Google Cloud Console with authorized redirect URI `<YOUR_ORIGIN>/api/v1/auth/google/callback` and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

### 2. Install Dependencies, Migrate & Seed
```bash
npm install
npm run db:setup
```

### 3. Run Development Server
```bash
npm run dev
```
Open `http://localhost:3000`.

### 4. Production PostgreSQL + PostGIS (Docker)
```bash
docker compose up -d postgres redis
```
Update `DATABASE_URL` in `.env` to `postgresql://volt_user:volt_password_change_me@localhost:5432/smart_parking_ev`, then run `npm run db:setup`.

---

## Demo Test Accounts (Seeded)

| Role | Email | Password |
| --- | --- | --- |
| Customer | `customer@smartmobility.test` | `Customer@123` |
| Parking Operator | `parking.op@smartmobility.test` | `Operator@123` |
| Operator Attendant | `attendant@smartmobility.test` | `Staff@123` |
| EV Operator | `ev.op@smartmobility.test` | `EvOperator@123` |
| Super Admin | `admin@smartmobility.test` | `Admin@123` |

---

## Scripts & Verification

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # Vitest unit + PostgreSQL concurrency/RBAC integration suite
npm run build       # Next.js production build
npm run test:e2e    # Playwright E2E specs (requires Chromium in CI)
```

---

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — System architecture, concurrency control, SSE pipeline, pricing & OCPP abstraction
- [`docs/er-diagram.md`](./docs/er-diagram.md) — Complete 28-table PostgreSQL Entity-Relationship diagram
- [`docs/api-spec.md`](./docs/api-spec.md) — All 26 `/api/v1/**` REST & SSE endpoints
- [`docs/deployment-security-limitations.md`](./docs/deployment-security-limitations.md) — Production deployment, security posture, and honest limitations
