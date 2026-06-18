# SALO Product Roadmap

SALO is a **modular operating system for appointment-based businesses** — barbers, salons, spas, dental and medical practices, wellness clinics, fitness studios, coaches, consultants, and similar operators.

**Platform architecture:** [salo-platform-architecture.md](./salo-platform-architecture.md) — industry templates, business modules, access roles, onboarding, and future pricing.

**Core language (industry-neutral):** **Client**, **Appointment**, **Service**, **Staff member**, **Business**.

---

## Product direction (2026)

SALO is evolving beyond a salon booking app into a configurable platform:

| Concept | Summary |
|---------|---------|
| **Industry templates** | Barber, Beauty Salon, Spa, Dental, Medical, Wellness, Fitness, Coaching, Other — configure defaults only; **never restrict features** |
| **Modules** | Businesses enable capabilities (Staff, Reception Desk, SMS, Loyalty, Memberships, Marketing, Analytics, AI Assistant, AI Receptionist, …) |
| **Roles** | Owner, Manager, Receptionist, Staff — always supported; businesses may use none, some, or all |
| **Pricing (future)** | Starter → Growth → Pro → Enterprise, with module-based add-ons |

**Next platform work (before Staff Roles implementation):** industry templates + module registry (see architecture doc §9).

---

## Completed

### Platform core ✅

- Business onboarding wizard (profile, services, team, hours, payments, public booking)
- Owner booking management (calendar, daily schedule, client contact capture)
- Services, staff, availability
- Public booking page + owner confirm workflow
- Stripe Connect deposits
- Google Calendar one-way sync (SALO → Google)
- Analytics dashboard (baseline)
- Owner push notifications (device alerts)

### PR3 — Client Profiles (MVP) ✅

Business-scoped client identity, profile metrics, relationship fields, and segmented appointment history.

**Design doc:** [pr3-client-profiles-design.md](./pr3-client-profiles-design.md)

**Deferred:** Phase 3.4 tags UI, preferred staff picker.

### PR4 — Notification Center ✅

Centralized in-app notification feed for business owners.

**Design doc:** [pr4-notification-center-design.md](./pr4-notification-center-design.md)

| Phase | Scope | Status |
|-------|-------|--------|
| 4.1 | Database + RLS | ✅ |
| 4.2 | Event emission (booking, payment, calendar, SMS failure) | ✅ |
| 4.3 | Realtime + unread badge | ✅ |
| 4.4 | Inbox UI, detail, read actions | ✅ |

### SMS Reminders — Foundation ✅

Client SMS for appointment updates and reminders (mock provider default).

**Design doc:** [sms-reminders-foundation.md](./sms-reminders-foundation.md)

| Component | Status |
|-----------|--------|
| `sms_notifications` queue + booking triggers | ✅ |
| `send-sms-notifications` worker (mock / Twilio) | ✅ |
| Failure → Notification Center | ✅ |

**Deferred:** Cron scheduler, Twilio webhooks, owner reminder settings UI.

---

## In progress / next

### P1 — Industry templates 🎯

- `industry_template` on business + template catalog (9 options)
- Template-driven defaults: display labels, sample services, module recommendations
- Onboarding step: "What type of business are you?"
- **Rule:** templates configure defaults only; no feature restrictions

### P2 — Business modules registry

- `business_modules` enablement per tenant
- Navigation and settings gated by `isModuleEnabled`
- Settings → Modules discovery UI
- Backfill: enable all currently-shipped modules for existing businesses

### P3 — Staff Roles (access control)

**Blocked on:** P1–P2 architecture review (design in [salo-platform-architecture.md](./salo-platform-architecture.md) §5).

- `business_members` (Owner, Manager, Receptionist, Staff)
- Invite / accept flow
- Permission matrix + RLS migration off `owner_user_id`-only policies
- Role-aware app navigation

### P4 — Onboarding v2

- Template-aware and module-aware wizard
- Solo operator fast path ("I work alone")
- Optional team invite step

### P5 — Subscription schema (pre-billing)

- `business_subscriptions` + `business_module_entitlements`
- Implicit Growth plan for existing customers until Stripe Billing ships

---

## Planned modules & features

| Module / area | Summary | Architecture `module_key` |
|---------------|---------|---------------------------|
| Reception desk | Front-desk day view, quick book, check-in | `reception_desk` |
| PR3.4 — Tags & preferred staff | Tag UI; preferred staff on client profile | `client_profiles` |
| Loyalty | Points / visit tiers | `loyalty` |
| Memberships | Recurring plans, credits | `memberships` |
| Marketing | Segments, campaigns (email/SMS hooks) | `marketing` |
| Rebooking reminders | Rules on `last_visit` / `next_appointment` | `sms_reminders` |
| AI assistant | Scheduling + outreach with client context | `ai_assistant` |
| AI receptionist | Automated booking + messaging | `ai_receptionist` |
| Google Calendar v2 | Staff calendars, busy import | `calendar_sync` |
| Brands / locations | Multi-location under one account | Enterprise |

---

## Future pricing (architecture only)

| Plan | Typical customer |
|------|------------------|
| **Starter** | Solo operator |
| **Growth** | Small team + SMS + notifications |
| **Pro** | Payments, marketing, loyalty |
| **Enterprise** | Multi-location, AI receptionist, compliance |

Module add-ons (e.g. SMS volume packs) layer on any tier. See [salo-platform-architecture.md](./salo-platform-architecture.md) §7.

---

## Explicitly out of scope (current cycle)

- Google → SALO calendar sync
- Per-industry code forks or feature lock-out by template
- HIPAA / industry compliance packs (Enterprise later)
- Full marketing automation UI
- Client-facing notification center
- Charging customers (schema first; Stripe Billing later)
