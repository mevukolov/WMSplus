-- One-time data repair, already applied to production 2026-08-26.
--
-- wms_employees.full_name had a 3-way rotation bug for employee_id 205912 /
-- 360763 / 877894: each row showed the name that belonged to a *different*
-- one of the three. public.users (where employees actually log in from --
-- id + fio there is the source of truth) had the correct mapping all along.
--
-- Confirmed before/after against public.users:
--   205912: was "Воронова Алена"  -> "Мусаев Роман"   (users.fio: Мусаев Роман Сергеевич)
--   360763: was "Ткачева Ксения"  -> "Воронова Алёна" (users.fio: Воронова Алёна Владимировна)
--   877894: was "Мусаев Роман"    -> "Ткачёва Ксения" (users.fio: Ткачёва Ксения Евгеньевна)
--
-- Kept the table's existing short-name convention (first + last, no
-- patronymic) rather than switching to full users.fio, to match the other
-- (already-correct) rows in this table.
--
-- Note: wms_tasks.assignee_name carries the same rotation bug across ~5200
-- historical rows (majority wrong, minority correct/full-name). Left
-- untouched for now -- the assignment system itself is expected to be
-- reworked, so a retroactive bulk-rename there was deferred.
update public.wms_employees
set full_name = case employee_id
  when '205912' then 'Мусаев Роман'
  when '360763' then 'Воронова Алёна'
  when '877894' then 'Ткачёва Ксения'
end
where employee_id in ('205912', '360763', '877894');
