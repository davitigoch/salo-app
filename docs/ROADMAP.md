# SALO Product Roadmap

SALO is a platform for **appointment-based service businesses** — salons, barbers, nail studios, spas, med spas, dentists, wellness clinics, therapists, coaches, tutors, fitness professionals, and similar operators.

Terminology is industry-neutral: **Client**, **Appointment**, **Service**, **Staff member**, **Business**.

---

## Completed

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

**Commits:** foundation → OAuth → settings UX → sync worker.

### Core platform (prior releases) ✅

- Business onboarding, services, staff, availability
- Owner booking management (calendar, daily schedule)
- Public booking + Stripe deposits / payments
- SMS notifications + owner push notifications
- Client appointment portal (reschedule / cancel)
- Analytics dashboard (baseline)
- Basic `clients` table + list/detail screens (pre-PR3)

---

## In progress / next

### PR3 — Client Profiles 🎯 **Next priority**

Upgrade lightweight CRM into full **Client Profiles** with business-scoped data, structured identity, relationship fields, computed metrics, and segmented history.

**Design doc:** [pr3-client-profiles-design.md](./pr3-client-profiles-design.md)

**Status:** Phase 3.1 database foundation implemented (`20260701_client_profiles_foundation.sql`).

**Status:** Phase 3.2 app data layer wired to client profile RPCs.

**Status:** Phase 3.3 UI refresh (not started).

---

## Planned (after PR3)

| Area | Summary |
|------|---------|
| Marketing & campaigns | Segments from tags + stats; email/SMS campaign hooks |
| Rebooking reminders | Rules engine on `last_visit` / `next_appointment` |
| Loyalty programs | Points / visit tiers (schema stubs in PR3) |
| AI assistant | Client context bundle RPC for scheduling + outreach |
| Google Calendar v2 | Staff calendars, busy import, multi-calendar (explicitly out of MVP scope) |
| Brands / locations | Multi-location businesses under one owner account |

---

## Explicitly out of scope (current cycle)

- Google → SALO calendar sync
- Staff-level Google calendars
- Beauty-industry-only terminology or workflows
- Full marketing automation UI
