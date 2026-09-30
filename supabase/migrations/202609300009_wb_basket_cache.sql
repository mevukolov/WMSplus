-- card.wb.ru / u-card.wb.ru are now behind WB's own anti-bot layer
-- (wbaas -- JS challenge + IP-bound session cookie, confirmed by hand:
-- direct requests get 403 even with spoofed Referer/Origin). But WB also
-- publishes every product's card as a plain static JSON file on its
-- basket CDN, unauthenticated, no rate limit, no anti-bot:
--   https://basket-{NN}.wbbasket.ru/vol{VOL}/part{PART}/{NM}/info/ru/card.json
-- where VOL = nm div 100000, PART = nm div 1000, and NN (which physical
-- basket number holds a given VOL) isn't derivable by formula -- WB adds
-- baskets over time, so it has to be discovered by probing candidate
-- basket numbers and cached, per this well-known pattern (see e.g.
-- https://vc.ru/marketing/3103948 for the vol/part math). All nm's that
-- share the same 100k-wide vol live on the same basket, so the cache
-- turns "probe up to ~60 hosts" into "single direct hit" for every nm
-- after the first one in that vol range.
create table if not exists public.wms_wb_basket_cache (
    vol integer primary key,
    basket_no smallint not null,
    updated_at timestamptz not null default now()
);
