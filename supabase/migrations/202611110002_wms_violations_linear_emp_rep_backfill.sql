-- The first numeric-ID migration could only resolve the tiny WMS roster.
-- Linear Emp Rep is the full warehouse directory, so use its unambiguous
-- name-to-ID pairs to recover historic violation records as well.
with linear_name_map as (
    select
        lower(regexp_replace(btrim(linear_emp_name), '\s+', ' ', 'g')) as normalized_name,
        min(linear_emp_id)::text as employee_id
    from public.linear_emp_rep
    where linear_emp_id is not null
      and nullif(btrim(coalesce(linear_emp_name, '')), '') is not null
    group by lower(regexp_replace(btrim(linear_emp_name), '\s+', ' ', 'g'))
    having count(distinct linear_emp_id) = 1
)
update public.wms_violations as violation
set culprit_employee_id = directory.employee_id,
    culprit_name = null
from linear_name_map as directory
where violation.culprit_employee_id is null
  and directory.normalized_name
      = lower(regexp_replace(btrim(coalesce(violation.culprit_name, '')), '\s+', ' ', 'g'));
