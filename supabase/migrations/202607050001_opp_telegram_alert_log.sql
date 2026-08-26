create table if not exists public.opp_telegram_alert_log (
  id bigserial primary key,
  alert_key text not null unique,
  wh_id text,
  cache_scope text,
  alert_type text,
  severity text,
  title text,
  message text,
  telegram_chat_id text,
  telegram_message_id bigint,
  meta jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists opp_telegram_alert_log_sent_at_idx
  on public.opp_telegram_alert_log (sent_at desc);

create index if not exists opp_telegram_alert_log_wh_scope_idx
  on public.opp_telegram_alert_log (wh_id, cache_scope, sent_at desc);
