# REST & SSE API Specification (`/api/v1`)

All endpoints return standardized JSON envelopes:
- Success: `{ "ok": true, "data": { ... } }`
- Error: `{ "ok": false, "error": { "code": "...", "message": "..." } }`

## Health & Real-Time Events
| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | Public | Reports database status, PostGIS capability, and gateway mode |
| `GET` | `/api/v1/events/stream` | Public | Server-Sent Events (SSE) stream (`?facilityId=` optional) |

## Authentication & Customer Account
| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Public | Register customer/operator account (rate limited) |
| `POST` | `/api/v1/auth/login` | Public | Email + password login (`sm_session` HTTP-only cookie) |
| `POST` | `/api/v1/auth/logout` | Public | Clear session cookie |
| `GET` | `/api/v1/auth/session` | Public | Inspect authenticated user + demo mode metadata |
| `POST` | `/api/v1/auth/verify` | Public | Verify account or issue recovery token |
| `GET` | `/api/v1/auth/google` | Public | Start Google OAuth 2.0 + PKCE flow (`?redirectTo=` optional) |
| `GET` | `/api/v1/auth/google/callback` | Public | Verify CSRF state, exchange code, validate Google ID token & set `sm_session` |
| `GET/PATCH` | `/api/v1/customer/overview` | Auth | Customer dashboard data or profile/consent update |
| `POST/DELETE` | `/api/v1/customer/vehicles` | Auth | Manage registered vehicles |
| `POST` | `/api/v1/customer/actions` | Auth | Toggle saved facility, mark alerts read, submit support ticket |

## Discovery, Availability & Insights
| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/facilities` | Public | Bounds, radius, EV/connector, price & amenity search |
| `GET` | `/api/v1/facilities/[id]` | Public | Facility detail by ID or slug + zones, spaces, chargers, reviews |
| `GET/POST` | `/api/v1/availability/[facilityId]` | Public | Window-aware availability (`GET`) and demo sensor pulse (`POST`) |
| `GET` | `/api/v1/insights/heatmap` | Public | City-wide occupancy & demand zones |
| `POST` | `/api/v1/insights/ev-trip` | Public | Rule-based EV range & corridor charging stop planner |

## Pricing, Reservations, Payments & EV Charging
| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/v1/pricing/estimate` | Public | Server-authoritative integer-paise price quote |
| `POST` | `/api/v1/reservations` | Auth | Create atomic bay/connector hold (`FOR UPDATE` serialized) |
| `GET` | `/api/v1/reservations/[id]` | Owner/Op/Admin | Reservation detail, items, payments & signed QR |
| `POST` | `/api/v1/reservations/[id]/extend` | Owner | Extend active reservation and calculate delta fee |
| `POST` | `/api/v1/reservations/[id]/cancel` | Owner/Admin | Cancel with policy-based refund computation |
| `POST` | `/api/v1/reservations/check-in` | Operator/Admin | Validate HMAC QR payload or booking ref at gate |
| `POST` | `/api/v1/reservations/[id]/check-out` | Operator/Admin | Complete session & reconcile overstay fees |
| `POST` | `/api/v1/payments/orders` | Auth | Create idempotent payment order for reservation hold |
| `POST` | `/api/v1/payments/verify` | Auth | Verify HMAC payment signature & confirm / recover hold |
| `POST` | `/api/v1/payments/webhook` | Signed Webhook | Idempotent Razorpay webhook handler (`x-razorpay-signature`) |
| `GET` | `/api/v1/payments/history` | Auth | List user payments, orders & refunds |
| `POST` | `/api/v1/charging/sessions` | Auth | Start EV charging session (`InternalSimulatedChargeProvider`) |
| `POST` | `/api/v1/charging/sessions/[id]/tick` | Owner/Op/Admin | Advance simulated kWh telemetry & live cost |
| `POST` | `/api/v1/charging/sessions/[id]/stop` | Owner/Op/Admin | Stop charging session & finalize GST receipt |

## Operator & Super Admin
| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/operator/dashboard` | Operator/Admin | Ownership-scoped facilities, inventory & persisted KPIs |
| `POST` | `/api/v1/operator/facilities` | Operator/Admin | Onboard new facility (defaults `PENDING_APPROVAL` for operators) |
| `PATCH` | `/api/v1/operator/facilities/[id]/spaces` | Owner Op/Admin | Toggle bay status + SSE broadcast |
| `POST/PATCH` | `/api/v1/operator/facilities/[id]/connectors` | Owner Op/Admin | Add connector or update fault/status + SSE broadcast |
| `GET` | `/api/v1/admin/overview` | Super Admin | Platform KPIs, freshness report, tickets, audit logs |
| `POST` | `/api/v1/admin/facilities/[id]/review` | Super Admin | Approve, suspend, or reject facility |
| `POST` | `/api/v1/admin/operators/[id]/review` | Super Admin | Approve, suspend, or reject operator account |
| `PATCH` | `/api/v1/admin/settings` | Super Admin | Update platform fee bps, tax bps, hold TTL |
| `POST` | `/api/v1/admin/tickets/[id]/resolve` | Super Admin | Resolve customer support / billing dispute |
