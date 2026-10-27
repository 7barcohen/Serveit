-- Removes only the flow-test data created by seed_flow_test_data.sql.
-- Does not remove or alter either test account or any untagged records.

begin;

do $$
declare
  v_worker_id integer;
  v_employer_id integer;
begin
  select id into v_worker_id
  from public."User"
  where lower(email) = lower('shirtoren25@gmail.com') and role = 'WORKER';

  select id into v_employer_id
  from public."User"
  where lower(email) = lower('pillipgal@gmail.com') and role = 'EMPLOYER';

  if v_worker_id is not null then
    delete from public."WorkerPreference"
    where "workerId" = v_worker_id
      and "createdAt" = '2099-12-31 23:59:59+00'::timestamptz
      and city = 'תל אביב'
      and categories = array['אירועים', 'מסעדנות']::text[];
  end if;

  if v_employer_id is not null then
    delete from public."Job"
    where "employerId" = v_employer_id
      and title like '[TEST-SERVEIT-20261027]%';
  end if;
end;
$$;

commit;

select '[TEST-SERVEIT-20261027] Test jobs and related applications, messages, offers, and notifications removed.' as result;
