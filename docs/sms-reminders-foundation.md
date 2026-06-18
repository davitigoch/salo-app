# SMS Reminders — Foundation Plan

**Status:** Phase 1 foundation (mock provider, queue + worker)  
**Goal:** Client SMS architecture for appointment updates and reminders without requiring paid Twilio.

---

## 1. Implementation plan

### Phase 1 (this delivery)

1. **Database** — Create/evolve `sms_notifications` with queue fields, statuses, mock/twilio provider, RLS, indexes, `claim_sms_notifications` RPC.
2. **Enqueue triggers** — Replace legacy booking SMS trigger with queue logic for confirmed / rescheduled / cancelled + schedule 24h/2h reminders.
3. **Worker** — New `send-sms-notifications` edge function; default `SMS_PROVIDER=mock`.
4. **Failures** — Terminal SMS failure → existing `message_delivery_failed` notification center trigger.
5. **Verification** — SQL script with mock send path.

### Phase 2 (deferred)

- Cron/scheduler to invoke `send-sms-notifications` periodically.
- Twilio delivery webhooks → `delivered` status.
- Owner settings UI for reminder toggles.
- Cancel/reschedule reminder dedupe hardening.
- Deprecate `send-booking-sms` after cutover.

### Out of scope

- Two-way SMS replies.
- Marketing campaigns.
- Payment/Twilio setup requirements.

---

## 2. Files to change

| File | Change |
|------|--------|
| `supabase/migrations/20260705_sms_reminders_foundation.sql` | Table, RLS, enqueue triggers, claim RPC, failure trigger update |
| `supabase/functions/send-sms-notifications/index.ts` | New worker (mock + twilio) |
| `supabase/functions/_shared/smsMessages.ts` | Message templates |
| `supabase/scripts/verify_sms_reminders_foundation.sql` | Verification script |
| `docs/sms-reminders-foundation.md` | This plan |
| `docs/ROADMAP.md` | SMS reminders foundation entry |

**Unchanged (legacy, kept for reference):**

- `supabase/functions/send-booking-sms/index.ts` — not removed; superseded by `send-sms-notifications`.

---

## 3. Database migration plan

### `sms_notifications` schema

| Column | Purpose |
|--------|---------|
| `business_id`, `booking_id`, `client_id` | Scoping + client link |
| `phone_number` | E.164 or raw client phone |
| `message_body` | Optional pre-rendered body |
| `notification_type` | `booking_confirmed`, `booking_rescheduled`, `booking_cancelled`, `reminder_24h`, `reminder_2h` |
| `status` | `queued`, `sent`, `failed`, `delivered`, `skipped` |
| `provider` | `mock` (default), `twilio` |
| `provider_message_id` | Twilio SID or `mock_*` id |
| `scheduled_for` | Send-not-before time (immediate = now) |
| `sent_at`, `delivered_at` | Delivery timestamps |
| `retry_count`, `max_retries`, `last_error` | Worker retry |

### Enqueue rules

| Event | `notification_type` | `scheduled_for` |
|-------|---------------------|-----------------|
| Booking confirmed (insert or status → confirmed) | `booking_confirmed` | now |
| Date/time change | `booking_rescheduled` | now |
| Status → cancelled | `booking_cancelled` | now; skip queued reminders |
| On confirm/reschedule | `reminder_24h` | appointment − 24h |
| On confirm/reschedule | `reminder_2h` | appointment − 2h |

Reminders only scheduled when `scheduled_for > now()` and client SMS prefs enabled.

### Dedupe

- Unique partial index on `(booking_id, notification_type)` where `status in ('queued', 'sent')` for immediate types.
- Reminders deduped per `(booking_id, notification_type, scheduled_for)`.

### Integration

- `emit_sms_delivery_failed_notification` trigger updated for new column names.
- Requires `notification_preferences.enable_customer_sms` and `send_status_update_sms`.

---

## 4. Testing plan

### Automated (SQL, rolls back)

```bash
npx supabase db push
npx supabase db query --file supabase/scripts/verify_sms_reminders_foundation.sql
```

Script verifies:

1. Table + RPC + trigger exist.
2. Confirmed booking enqueues `booking_confirmed` + future reminders.
3. Reschedule enqueues `booking_rescheduled` and reschedules reminder rows.
4. Cancel enqueues `booking_cancelled` and marks queued reminders `skipped`.
5. `claim_sms_notifications` returns due rows.

### Manual (mock worker)

```bash
# Invoke worker locally or via Supabase dashboard
curl -X POST "$SUPABASE_URL/functions/v1/send-sms-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 20}'
```

With `SMS_PROVIDER=mock` (default):

1. Confirm booking with client phone → rows `queued`.
2. Invoke worker → rows `sent`, `provider_message_id` starts with `mock_`.
3. Set `SMS_PROVIDER=twilio` without secrets → retries then `failed`.
4. Failed row → `message_delivery_failed` in notification center inbox.

### Secrets (future Twilio)

| Secret | Required when |
|--------|----------------|
| `SMS_PROVIDER` | `mock` (default) or `twilio` |
| `TWILIO_ACCOUNT_SID` | `SMS_PROVIDER=twilio` |
| `TWILIO_AUTH_TOKEN` | `SMS_PROVIDER=twilio` |
| `TWILIO_FROM_NUMBER` | `SMS_PROVIDER=twilio` |
