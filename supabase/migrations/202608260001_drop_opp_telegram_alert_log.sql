-- Telegram integration removed (opp-telegram-alerts edge function deleted).
-- opp_telegram_alert_log only recorded dedupe state for that function; safe to drop.
drop table if exists public.opp_telegram_alert_log;
