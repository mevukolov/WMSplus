-- The violation log uses the employee's business ID from Linear Emp Rep,
-- never an internal wms_employees UUID or a free-form name. Names remain a
-- display concern: dashboards resolve them from the current employee roster.

-- Convert rows created while the form still stored the internal UUID.
update public.wms_violations as violation
set culprit_employee_id = employee.employee_id,
    culprit_name = null
from public.wms_employees as employee
where violation.culprit_employee_id = employee.id::text;

-- Convert older numeric values that were accidentally saved into the name
-- field instead of culprit_employee_id.
update public.wms_violations
set culprit_employee_id = btrim(culprit_name),
    culprit_name = null
where culprit_employee_id is null
  and btrim(coalesce(culprit_name, '')) ~ '^[0-9]+$';

-- Recover historic free-form names where Linear Emp Rep has an exact match.
update public.wms_violations as violation
set culprit_employee_id = employee.employee_id,
    culprit_name = null
from public.wms_employees as employee
where violation.culprit_employee_id is null
  and lower(regexp_replace(btrim(coalesce(violation.culprit_name, '')), '\s+', ' ', 'g'))
      = lower(regexp_replace(btrim(coalesce(employee.full_name, '')), '\s+', ' ', 'g'));

-- Existing unmatched legacy names are intentionally retained for audit, but
-- all new writes must use a numerical employee ID. NOT VALID still enforces
-- the rule for every row written after this migration.
do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'wms_violations_culprit_employee_id_numeric'
          and conrelid = 'public.wms_violations'::regclass
    ) then
        alter table public.wms_violations
            add constraint wms_violations_culprit_employee_id_numeric
            check (culprit_employee_id is null or culprit_employee_id ~ '^[0-9]+$') not valid;
    end if;
end $$;
