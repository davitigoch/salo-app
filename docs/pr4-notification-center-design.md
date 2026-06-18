# PR4 — Notification Center: Technical Design & Implementation Plan

**Status:** Proposed (pre-implementation)  
**Goal:** Give business owners a **centralized in-app notification center** — a persistent, readable feed of business events that complements (not replaces) device push alerts.

---

## 1. Current state (baseline)

### What exists today

| Layer | Notes |
|-------|-------|
| `owner_push_notifications` | Queue for Expo push delivery; booking-scoped; `event_type`, title, body, `push_data` |
| `owner_push_tokens` | Device tokens per owner user |
| `notification_preferences` | Per-business toggles (`enable_owner_push`, sound) |
| `send-owner-push` edge function | Drains push queue to Expo |
| App | `NotificationSettingsScreen` — push permission + sound; tap push → navigate to booking |
| SMS / email | Outbound reminders and confirmations via existing jobs; failures logged in job tables |

### Gaps vs PR4 requirements

| Requirement | Gap |
|-------------|-----|
| In-app notification inbox | No persistent feed; push is ephemeral |
| Read / unread state | No `notification_reads` |
| Unread badge in navigation | Not implemented |
| All event types in one place | Push covers subset of booking events only |
| Payment received | Not in owner notification feed |
| Calendar sync failures | Logged on booking/connection rows; not surfaced in app |
| SMS/email delivery failures | Not surfaced in app |
| Realtime inbox updates | Push only; no Realtime subscription |
| Mark all as read | N/A |

### Design principle

**`notification_events` is the source of truth for the in-app center.** Device push remains a delivery channel: the notification service may enqueue both a `notification_events` row and an `owner_push_notifications` row when preferences allow.

Terminology: **Client**, **Appointment**, **Business** — no industry-specific wording.

---

## 2. Event catalog (MVP)

| `event_type` | Title pattern (example) | Typical `entity_type` / `entity_id` |
|--------------|-------------------------|--------------------------------------|
| `booking_created` | New appointment for {client} | `booking` |
| `booking_confirmed` | Appointment confirmed — {client} | `booking` |
| `booking_cancelled` | Appointment cancelled — {client} | `booking` |
| `booking_rescheduled` | Appointment rescheduled — {client} | `booking` |
| `public_booking_request` | New booking request from {client} | `booking` |
| `payment_received` | Payment received — {amount} | `booking` or `payment` |
| `calendar_sync_failed` | Google Calendar sync failed | `booking` |
| `message_delivery_failed` | {SMS/Email} could not be delivered | `booking` or `client` |

**Payload (`metadata` jsonb):** `booking_id`, `client_id`, `client_name`, `service`, `appointment_at`, `amount_cents`, `channel` (`sms` \| `email`), `error_summary`, `calendar_connection_id`, etc.

**Severity (`severity` text):** `info` (default), `warning` (failures), `success` (payment received).

---

## 3. Proposed database schema

### 3.1 `notification_events`

```sql
create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,  -- recipient owner
  event_type text not null,
  severity text not null default 'info'
    check (severity in ('info', 'success', 'warning')),
  title text not null,
  body text not null,
  entity_type text,          -- 'booking', 'client', 'payment', 'calendar_connection'
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,           -- optional idempotency key per business
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists notification_events_business_created_idx
  on public.notification_events (business_id, created_at desc);

create index if not exists notification_events_user_created_idx
  on public.notification_events (user_id, created_at desc);

create unique index if not exists notification_events_dedupe_idx
  on public.notification_events (business_id, dedupe_key)
  where dedupe_key is not null;

alter table public.notification_events enable row level security;
```

**`event_type` check constraint** (MVP set):

```sql
check (event_type in (
  'booking_created',
  'booking_confirmed',
  'booking_cancelled',
  'booking_rescheduled',
  'public_booking_request',
  'payment_received',
  'calendar_sync_failed',
  'message_delivery_failed'
))
```

**Dedupe examples:**

- `booking:{id}:confirmed` — avoid duplicate confirm events
- `calendar_sync:{booking_id}:failed` — one failure row per booking per attempt window (or latest wins via upsert policy in service layer)

### 3.2 `notification_reads`

```sql
create table if not exists public.notification_reads (
  notification_event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default timezone('utc', now()),
  primary key (notification_event_id, user_id)
);

create index if not exists notification_reads_user_idx
  on public.notification_reads (user_id);

alter table public.notification_reads enable row level security;
```

Unread = `notification_events` for `user_id` with no matching `notification_reads` row.

### 3.3 RLS policies

**`notification_events`**

- `SELECT`: `auth.uid() = user_id`
- `INSERT`: service role / security definer RPCs only (not direct client insert)
- No owner `UPDATE` / `DELETE` (immutable audit log; optional retention job later)

**`notification_reads`**

- `SELECT`: `auth.uid() = user_id`
- `INSERT`: `auth.uid() = user_id` and event belongs to same user
- `DELETE`: none (reads are append-only)

### 3.4 RPCs

| RPC | Purpose |
|-----|---------|
| `list_notification_events(p_limit, p_offset, p_unread_only)` | Paginated inbox for current user + business |
| `get_notification_unread_count()` | Badge count |
| `mark_notification_read(p_event_id)` | Single read |
| `mark_all_notifications_read()` | Bulk read for current user |
| `emit_notification_event(...)` | Security definer; called from triggers / edge functions |

---

## 4. Notification service (Phase 4.2)

Central `emit_notification_event` function (SQL or shared TS module in edge functions):

```text
emit_notification_event({
  business_id,
  user_id,           -- business owner
  event_type,
  title,
  body,
  entity_type,
  entity_id,
  metadata,
  dedupe_key,
  severity,
  also_push: boolean  -- respect notification_preferences.enable_owner_push
})
```

### Emit points (MVP)

| Source | Events |
|--------|--------|
| Booking insert / status trigger | `booking_created`, `booking_confirmed`, `booking_cancelled`, `booking_rescheduled` |
| Public booking RPC | `public_booking_request` |
| Stripe webhook / payment update | `payment_received` |
| `process-calendar-sync-jobs` | `calendar_sync_failed` on terminal failure |
| SMS/email job failure handler | `message_delivery_failed` |

**Relationship to `owner_push_notifications`:** When `also_push` is true, service inserts into `owner_push_notifications` with `push_data` containing `notificationEventId` for deep linking. Existing `send-owner-push` worker unchanged.

---

## 5. Realtime delivery (Phase 4.3)

- Enable Realtime on `notification_events` (and optionally `notification_reads` for badge sync).
- App subscribes: `business_id=eq.{id}` AND `user_id=eq.{uid}` on INSERT.
- On INSERT: increment local unread count; optional in-app toast if screen not focused.
- On `mark_notification_read` / `mark_all_notifications_read`: optimistic UI + refetch unread count RPC.

**Badge:** `get_notification_unread_count()` on app focus + after Realtime INSERT; expose via `NotificationsContext`.

---

## 6. App UI (Phase 4.4)

### Screens

| Screen | Route | Notes |
|--------|-------|-------|
| `NotificationCenterScreen` | `NotificationCenter` | Grouped list (Today / Earlier); pull to refresh; mark all read |
| `NotificationDetailScreen` | `NotificationDetail` | Full body + metadata; CTA → booking detail, client profile, calendar settings, or payment settings |

### Navigation

- Bell icon on `HomeScreen` header (or tab bar badge) with unread count
- Tap → `NotificationCenter`
- Row tap → `NotificationDetail` → primary action deep link

### Copy (industry-neutral)

- "New appointment for {client}"
- "Booking request from {client}"
- "Payment received"
- "Google Calendar sync failed"
- "Message could not be delivered"

### Components

- `NotificationRow` — icon by `event_type` / `severity`, title, relative time, unread dot
- `useNotifications` hook — list, unread count, mark read, Realtime subscription

---

## 7. Implementation phases

### Phase 4.1 — Database + RLS

- Migration: `notification_events`, `notification_reads`, constraints, indexes
- RLS policies
- RPCs: list, unread count, mark read, mark all read, emit (security definer)
- Verification script
- **No app UI changes**

### Phase 4.2 — Notification service

- Wire `emit_notification_event` from booking triggers / app server paths
- Stripe payment success → `payment_received`
- Calendar sync worker → `calendar_sync_failed`
- Messaging failure hooks → `message_delivery_failed`
- Bridge to `owner_push_notifications` where appropriate
- **No inbox UI yet** (verify via SQL / script)

### Phase 4.3 — Realtime delivery

- Enable Realtime publication for `notification_events`
- `NotificationsContext` + unread count
- Subscribe on business session start; cleanup on logout
- **Badge only** (no full inbox screen yet)

### Phase 4.4 — UI screens

- `NotificationCenterScreen` + `NotificationDetailScreen`
- Navigation routes + bell entry point
- Mark read / mark all as read
- Deep links from detail to booking, client, settings

**Estimated sequence:** 4.1 → 4.2 → 4.3 → 4.4 (4.3 and 4.4 can overlap once RPCs exist).

---

## 8. Risks & decisions

| Topic | Decision |
|-------|----------|
| Immutable event log | Events are insert-only; reads tracked separately |
| Multi-owner businesses | MVP: one `user_id` per event (business owner); staff accounts deferred |
| Retention | Keep 90 days MVP; archival job later |
| Push vs inbox | Inbox always records; push respects `notification_preferences` |
| Dedup | `dedupe_key` on hot paths (confirm, payment) to prevent spam |
| Backfill | Optional: seed recent rows from `owner_push_notifications` (sent only) |

---

## 9. Out of scope for PR4

- Client-facing notification center
- Email digest of unread notifications
- Per-event-type preference toggles (beyond existing owner push master switch)
- Staff-member notification routing
- Marketing / campaign notifications

---

## 10. Success criteria

- [ ] Owner sees unread badge when new booking / payment / failure events occur
- [ ] Inbox lists all eight MVP event types with correct copy
- [ ] Mark read and mark all as read persist and update badge immediately
- [ ] Realtime INSERT appears in inbox without manual refresh
- [ ] Notification detail deep links to relevant booking or settings screen
- [ ] RLS prevents cross-business / cross-user access
- [ ] No beauty-specific strings in PR4 UI copy
