# SALO Product Roadmap

SALO is a platform for **appointment-based service businesses** — salons, barbers, nail studios, spas, med spas, dentists, wellness clinics, therapists, coaches, tutors, fitness professionals, and similar operators.

Terminology is industry-neutral: **Client**, **Appointment**, **Service**, **Staff member**, **Business**.

---

## Completed

### PR3 — Client Profiles (MVP) ✅

Business-scoped client identity, profile metrics, relationship fields, and segmented appointment history.

- Database foundation (`clients` evolution, tags schema, `client_profile_stats`, RPCs)
- App data layer (`list_client_profiles`, `get_client_profile`)
- Client profile screen (metrics, relationship, contact, notes, upcoming/past appointments)
- Scroll-stable layout; pull-to-refresh on user action only

**Design doc:** [pr3-client-profiles-design.md](./pr3-client-profiles-design.md)

**Deferred post-MVP:** Phase 3.4 tags UI, preferred staff picker.

### Google Calendar integration (MVP) ✅

Verified end-to-end (June 2026).

- Google OAuth connection per business
- Dedicated **SALO Bookings** calendar (create or reuse)
- Background sync worker (`process-calendar-sync-jobs`)
- Confirmed booking → Google event create
- Reschedule → Google event update
- Cancel / hard delete → Google event removal
- Connection status screen (no raw calendar ID exposed)
- Sync monitoring fields on `bookings` and `google_calendar_connections`
- One-way sync: SALO → Google only

### Public Booking (MVP) ✅

- Public booking page per business
- Service / staff / slot selection
- Client contact capture
- Booking request → owner workflow

### Stripe Deposits ✅

- Stripe Connect onboarding
- Deposit collection on public bookings
- Payment status on bookings
- Owner payment settings screen

### Core platform (prior releases) ✅

- Business onboarding, services, staff, availability
- Owner booking management (calendar, daily schedule)
- SMS notifications + owner push notifications (device alerts)
- Client appointment portal (reschedule / cancel)
- Analytics dashboard (baseline)
- Basic `clients` table + list/detail screens (superseded by PR3)

---

## In progress / next

### PR4 — Notification Center 🎯 **Next priority**

Centralized in-app notification center for business owners — a durable feed beyond ephemeral push alerts.

**Design doc:** [pr4-notification-center-design.md](./pr4-notification-center-design.md)

**Event types (MVP):**

| Type | Trigger |
|------|---------|
| Booking created | Owner or staff creates a booking |
| Booking confirmed | Status → confirmed |
| Booking cancelled | Status → cancelled |
| Booking rescheduled | Date/time or staff change |
| Public booking request | New request from public booking flow |
| Payment received | Stripe deposit or payment succeeded |
| Google Calendar sync failure | `process-calendar-sync-jobs` permanent failure |
| SMS / email delivery failure | Outbound notification job failed |

**Database:** `notification_events`, `notification_reads`

**App features:**

- Unread badge on app navigation
- Mark as read / mark all as read
- Notification detail screen (deep link to booking, client, or settings)
- Realtime updates via Supabase Realtime

**Phases:**

| Phase | Scope | Status |
|-------|-------|--------|
| 4.1 | Database + RLS (`notification_events`, `notification_reads`, indexes, RPCs) | Implemented (`20260702_notification_center_foundation.sql`) |
| 4.2 | Notification service (emit events from booking, payment, calendar, messaging pipelines) | Implemented (`20260703_notification_center_emission.sql`) |
| 4.3 | Realtime delivery (business-scoped channel, unread count RPC) | Not started |
| 4.4 | UI screens (inbox, detail, badge, read actions) | Not started |

---

## Planned (after PR4)

| Area | Summary |
|------|---------|
| PR3.4 — Tags & preferred staff | Tag management UI; preferred staff picker on client profile |
| Marketing & campaigns | Segments from tags + stats; email/SMS campaign hooks |
| Rebooking reminders | Rules engine on `last_visit` / `next_appointment` |
| Loyalty programs | Points / visit tiers (schema stubs in PR3) |
| AI assistant | Client context bundle RPC for scheduling + outreach |
| Google Calendar v2 | Staff calendars, busy import, multi-calendar |
| Brands / locations | Multi-location businesses under one owner account |

---

## Explicitly out of scope (current cycle)

- Google → SALO calendar sync
- Staff-level Google calendars
- Beauty-industry-only terminology or workflows
- Full marketing automation UI
- Client-facing notification center (owner app only for PR4)
