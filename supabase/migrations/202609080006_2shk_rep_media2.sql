-- "2 ШК на товаре" now requires two photos instead of one. "2shk_rep" is
-- shared with an external Yandex Forms process this repo doesn't own --
-- add a purely additive nullable column for the second photo rather than
-- touching "media" (the first photo), so anything already reading "media"
-- keeps working unchanged.
alter table public."2shk_rep"
    add column media2 text;
