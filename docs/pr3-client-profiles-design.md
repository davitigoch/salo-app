# PR3 — Client Profiles: Technical Design & Implementation Plan

**Status:** Proposed (pre-implementation)  
**Goal:** Evolve SALO from salon-centric guest lists into a **generic Client CRM** for any appointment-based service business.

---

## 1. Current state (baseline)

### Database

| Object | Notes |
|--------|-------|
| `public.clients` | `client_name`, `phone`, `email`, `notes`, `user_id`, `created_at` |
| `public.bookings.client_id` | Optional FK; backfill migration links by email/phone/name |
| RLS | Clients scoped to `auth.uid() = user_id` — **not** `business_id` |

### App

| Screen | Notes |
|--------|-------|
| `ClientsScreen` | Search list; copy says "Premium guest profiles" (beauty-specific) |
| `ClientDetailScreen` | Stats + timeline computed in JS from all in-memory bookings |
| `AddClientScreen` | Single `client_name` field |
| `utils/clients.js` | Matching, stats (`getClientCrmStats`), public-booking sync on confirm |

### Gaps vs PR3 requirements

| Requirement | Gap |
|-------------|-----|
| First / last name | Single `client_name` only |
| Business metrics (cancellation count, etc.) | Partial; no cancellation/reschedule counts |
| Preferred staff, tags, source | Missing on client record |
| History segments | Single timeline; no cancelled/rescheduled filters |
| Business scope | Clients tied to owner `user_id`, not `business_id` |
| Scale | All metrics computed client-side from full booking list |
| Future CRM / marketing / AI | No segment tables, activity log, or extension hooks |

---

## 2. Design principles

1. **Client-first, industry-neutral** — no "guest", "patron", or salon-specific labels in schema or UI.
2. **Business-scoped data** — every client belongs to one `business_id` (aligns with bookings, staff, calendar).
3. **Bookings remain source of truth** — metrics derived from `bookings`, not duplicated blindly.
4. **Computed at read time first, cache when needed** — SQL view/RPC for MVP; optional stats table if perf requires.
5. **Extensible metadata** — `jsonb` extension fields for loyalty, AI, campaigns without schema churn.
6. **Incremental delivery** — ship schema + read API before UI polish.

---

## 3. Proposed database schema

### 3.1 Evolve `public.clients` → client core

```sql
-- Migration: 202607xx_client_profiles_core.sql

alter table public.clients
  add column if not exists business_id uuid references public.businesses(id) on delete cascade,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists display_name text,          -- computed fallback for UI
  add column if not exists preferred_staff_member_id uuid references public.staff_members(id) on delete set null,
  add column if not exists source text not null default 'owner_created'
    check (source in ('public_booking', 'owner_created', 'import', 'referral', 'unknown')),
  add column if not exists source_detail text,         -- e.g. referral code, import batch id
  add column if not exists profile_metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

-- Backfill business_id from owner's primary business / booking majority
-- Backfill first_name/last_name from client_name split heuristic
-- Backfill display_name = trim(first_name || ' ' || last_name) or client_name

create index if not exists clients_business_id_idx on public.clients (business_id);
create index if not exists clients_business_email_idx on public.clients (business_id, lower(email));
create index if not exists clients_business_phone_idx on public.clients (business_id, phone);
```

**Identity rules**

- `display_name` is what list cells and calendar labels use.
- `first_name` required on create; `last_name` optional (single-name clients, mononyms).
- Keep `client_name` temporarily as deprecated column; app writes both during transition, drop in PR3.2.

**Uniqueness (per business)**

```sql
create unique index if not exists clients_business_email_unique_idx
  on public.clients (business_id, lower(email))
  where email is not null and length(trim(email)) > 0;

create unique index if not exists clients_business_phone_unique_idx
  on public.clients (business_id, phone_normalized)
  where phone_normalized is not null;
```

Add `phone_normalized` generated or maintained column (`regexp_replace(phone, '\D', '', 'g')`).

### 3.2 Tags

```sql
create table if not exists public.client_tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  color text,                    -- optional UI hex
  created_at timestamptz not null default timezone('utc', now()),
  unique (business_id, lower(name))
);

create table if not exists public.client_tag_assignments (
  client_id uuid not null references public.clients(id) on delete cascade,
  tag_id uuid not null references public.client_tags(id) on delete cascade,
  assigned_at timestamptz not null default timezone('utc', now()),
  primary key (client_id, tag_id)
);
```

### 3.3 Booking activity log (reschedules + future CRM)

Bookings already store current `date`/`time`; reschedules are not auditable today.

```sql
create table if not exists public.client_booking_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  event_type text not null check (event_type in (
    'booking_created',
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'booking_completed',
    'booking_no_show'
  )),
  payload jsonb not null default '{}'::jsonb,   -- old_date, old_time, new_date, new_time, actor, source
  occurred_at timestamptz not null default timezone('utc', now())
);

create index client_booking_events_client_id_idx on public.client_booking_events (client_id, occurred_at desc);
```

Populated by **trigger on `bookings`** (INSERT/UPDATE) — mirrors calendar sync enqueue pattern.

### 3.4 Client profile stats (read model)

**Option A (recommended MVP):** SQL view + RPC

```sql
create or replace view public.client_profile_stats as
select
  c.id as client_id,
  c.business_id,
  count(b.*) filter (where b.status in ('pending','confirmed','completed')) as lifetime_bookings,
  count(b.*) filter (where b.status = 'cancelled') as cancellation_count,
  count(b.*) filter (where b.status = 'no_show') as no_show_count,
  coalesce(sum(b.price) filter (where b.status in ('confirmed','completed')), 0) as lifetime_revenue,
  max(b.date || 'T' || b.time) filter (
    where b.status in ('confirmed','completed')
      and (b.date || 'T' || b.time) < to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI')
  ) as last_visit_sort_key,
  min(b.date || 'T' || b.time) filter (
    where b.status in ('pending','confirmed')
      and (b.date || 'T' || b.time) >= to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI')
  ) as next_appointment_sort_key,
  count(cbe.*) filter (where cbe.event_type = 'booking_rescheduled') as rescheduled_count
from public.clients c
left join public.bookings b on b.client_id = c.id and b.business_id = c.business_id
left join public.client_booking_events cbe on cbe.client_id = c.id
group by c.id, c.business_id;
```

Refine date parsing to use business timezone (function `booking_starts_at(business_id, date, time)`).

**Option B (later):** `client_profile_stats` **table** refreshed by trigger — only if view perf is insufficient at scale.

### 3.5 Future-proof extension tables (stubs, no UI in PR3)

```sql
-- Marketing segments (manual + rule-based later)
create table public.client_segments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  rule_definition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

-- Loyalty ledger stub
create table public.client_loyalty_accounts (
  client_id uuid primary key references public.clients(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  points_balance integer not null default 0,
  tier text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

-- AI context cache (optional, populated by worker later)
-- profile_metadata.ai_summary, ai_last_summarized_at on clients suffices for PR3
```

### 3.6 RLS updates

Replace `user_id`-only policies with **business owner** checks (consistent with bookings):

```sql
-- SELECT/INSERT/UPDATE/DELETE on clients, client_tags, assignments
using (
  exists (
    select 1 from public.businesses b
    where b.id = clients.business_id
      and b.owner_user_id = auth.uid()
  )
);
```

Keep `user_id` on `clients` as `created_by_user_id` for audit; set from `auth.uid()` on insert.

---

## 4. API surface

### 4.1 Supabase / PostgREST (primary)

| Operation | Method | Notes |
|-----------|--------|-------|
| List clients | `GET /clients?business_id=eq.{id}&order=display_name` | Paginate; search via `ilike` on name/email/phone |
| Get client | `GET /clients?id=eq.{id}&select=*,client_tag_assignments(tag:client_tags(*)),client_profile_stats(*)` | Join tags + stats |
| Create client | `POST /clients` | Validates business ownership via RLS |
| Update client | `PATCH /clients?id=eq.{id}` | |
| Delete client | `DELETE /clients?id=eq.{id}` | Soft-delete optional later |
| Tags CRUD | `/client_tags`, `/client_tag_assignments` | |
| Booking history | `GET /bookings?client_id=eq.{id}&order=date.desc,time.desc` | Filter by `status` query param |
| Reschedule history | `GET /client_booking_events?client_id=eq.{id}&event_type=eq.booking_rescheduled` | |

### 4.2 RPC functions (recommended aggregates)

```sql
-- Single round-trip profile payload for mobile
create function public.get_client_profile(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  -- Returns: { client, stats, tags, upcoming[], history[], cancelled[], rescheduled_events[] }
$$;
```

```sql
-- List with stats for Clients tab (avoid N+1)
create function public.list_client_profiles(
  p_business_id uuid,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (...) 
```

Grant `execute` to `authenticated`; validate `businesses.owner_user_id = auth.uid()`.

### 4.3 Edge functions (defer unless needed)

No edge function required for PR3 MVP. Consider later:

- `import-clients-csv` (bulk `source = 'import'`)
- `merge-duplicate-clients`
- `generate-client-ai-summary`

### 4.4 Booking ↔ client linking (existing + extend)

On booking INSERT/UPDATE (confirmed public booking, owner booking with client picker):

1. Resolve client by `client_id` OR normalized email/phone within `business_id`.
2. Create client if missing; set `source` from `booking_source` map:
   - `public` → `public_booking`
   - `owner` → `owner_created`
3. Write `client_booking_events` from trigger.

---

## 5. Mobile app architecture

### 5.1 Data layer

| Module | Change |
|--------|--------|
| `ClientsContext` | Fetch by `business.id`; use `list_client_profiles` RPC |
| `utils/clients.js` | Thin wrappers; deprecate client-side full-booking aggregation |
| `constants/clientSource.js` | Labels for source enum (generic copy) |
| New `utils/clientProfiles.js` | Formatters: `getClientDisplayName`, metric labels |

### 5.2 Screens

| Screen | PR3 scope |
|--------|-----------|
| **ClientsScreen** | Rename subtitle → "Client profiles"; show display name, last visit, next appointment, tags chips; sort by recent activity |
| **ClientProfileScreen** (rename from `ClientDetailScreen`) | Sections: Core info, Business metrics, Relationship, History tabs |
| **AddClientScreen** | `first_name`, `last_name`, phone, email, notes, preferred staff, tags, source (read-only on edit for auto-created) |
| **ClientBookingHistoryScreen** (optional split) | Filter: All / Upcoming / Past / Cancelled |

### 5.3 Client Profile UI layout

```
┌─────────────────────────────────────┐
│  [Avatar]  Jane Doe                 │
│            Client since Mar 12, 2026│
├─────────────────────────────────────┤
│  Metrics (2x3 grid)                 │
│  Lifetime bookings | Revenue        │
│  Avg spend         | Last visit     │
│  Next appointment  | No-shows       │
│  Cancellations     | Rescheduled    │
├─────────────────────────────────────┤
│  Relationship                       │
│  Preferred staff: Alex              │
│  Tags: [VIP] [Regular]              │
│  Source: Public booking             │
├─────────────────────────────────────┤
│  Contact + actions (call/text/email)│
├─────────────────────────────────────┤
│  Notes (editable)                   │
├─────────────────────────────────────┤
│  History [Upcoming|Past|Cancelled] │
│  Timeline rows → BookingDetail      │
└─────────────────────────────────────┘
```

Copy examples use neutral language: "appointment", not "visit" or "treatment" (configurable label later per business type).

### 5.4 Navigation

- `ROUTES.ClientProfile` (alias existing `ClientDetail` route during migration)
- Deep link: `clients/:clientId` (future)

---

## 6. Metric definitions

| Metric | Definition |
|--------|------------|
| Lifetime bookings | Count where `status ∈ {pending, confirmed, completed}` |
| Lifetime revenue | Sum `price` where `status ∈ {confirmed, completed}` |
| Average spend | `lifetime_revenue / count(completed)`; 0 if none |
| Last visit | Latest past appointment with `status ∈ {confirmed, completed}` (business TZ) |
| Next appointment | Earliest future appointment with `status ∈ {pending, confirmed}` |
| No-show count | `status = 'no_show'` |
| Cancellation count | `status = 'cancelled'` |
| Rescheduled count | Rows in `client_booking_events` where `event_type = 'booking_rescheduled'` |

---

## 7. Migration & backfill strategy

1. Add nullable columns + indexes (no breakage).
2. Backfill `business_id` on clients from owner's business (or most frequent booking `business_id`).
3. Split `client_name` → `first_name` / `last_name` / `display_name`.
4. Enforce `business_id NOT NULL` + new RLS.
5. Deploy triggers for `client_booking_events`.
6. Deploy views/RPCs.
7. Update app to business-scoped queries.
8. Drop deprecated `client_name` column after app cutover.

**Verification script:** `supabase/scripts/verify_client_profiles_pr3.sql`  
- Schema presence  
- RLS owner isolation  
- Stats RPC returns expected counts for fixture client  
- Booking confirm creates/links client with `source = public_booking`

---

## 8. Implementation plan (phased PRs)

### Phase 3.1 — Schema & backfill (backend only)

- Migrations: core columns, `business_id`, phone normalization, RLS
- `client_booking_events` trigger
- `client_profile_stats` view + `get_client_profile` RPC
- Backfill + verification script
- **No app UI changes** (existing screens keep working via `client_name` compat)

### Phase 3.2 — API integration

- Update `ClientsContext` / `AppNavigator` CRUD for new fields
- Switch list/detail to RPC payloads
- Auto-set `source` on public booking client sync
- Link all new bookings to `business_id`-scoped clients

### Phase 3.3 — Client Profile UI

- Rename copy ("Client profiles", remove salon references)
- Split name fields on Add/Edit
- Metrics grid + relationship section
- History segmented tabs

### Phase 3.4 — Tags & preferred staff

- Tag management UI (business settings or inline on profile)
- Preferred staff picker (staff list from business)

### Phase 3.5 — Polish & future hooks

- Segment table admin (read-only list)
- `profile_metadata` conventions doc for AI/loyalty teams
- Performance pass (indexes, pagination)

**Estimated sequence:** 3.1 → 3.2 → 3.3 (shippable MVP) → 3.4 → 3.5.

---

## 9. Risks & decisions

| Topic | Decision |
|-------|----------|
| `user_id` vs `business_id` on clients | Add `business_id`; keep `user_id` as creator audit |
| Duplicate clients | Unique email/phone per business; merge tool deferred |
| Multi-business owners | Each business has separate client roster (correct for franchises) |
| Stats freshness | Live view for MVP; materialize if >500ms p95 |
| GDPR / delete | Hard delete client; `bookings.client_id` → SET NULL (existing FK) |

---

## 10. Out of scope for PR3

- Marketing campaign sends
- Loyalty redemption UI
- AI-generated summaries (schema hook only)
- Client self-service profile portal
- CSV import UI (schema supports `source = import`)

---

## 11. Success criteria

- [ ] Owner sees **Client Profile** with all core + metric + relationship fields
- [ ] Metrics match manual booking queries for test client
- [ ] Public booking confirmation creates/links client with correct `source`
- [ ] Reschedule increments rescheduled count and appears in history
- [ ] No beauty-specific strings in PR3 UI copy
- [ ] RLS prevents cross-business client access
