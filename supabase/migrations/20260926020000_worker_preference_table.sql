-- A worker can save several job preferences (e.g. "temporary, Tel Aviv, evenings"
-- and "permanent, Jerusalem, mornings"). The job feed shows jobs matching ANY of them.
-- Replaces the single set of preference columns on "WorkerProfile".
-- Run in Supabase Dashboard -> SQL Editor after 20260926010000_employment_type_and_worker_preferences.sql.

create table "WorkerPreference" (
  "id"              serial primary key,
  "workerId"        integer not null references "User"("id") on delete cascade,
  "employmentType"  "EmploymentType" not null,
  "minHourlyPay"    integer not null default 35,
  -- Empty arrays mean "no restriction".
  "preferredShifts" "ShiftWindow"[] not null default '{}',
  "regions"         "Region"[] not null default '{}',
  -- Only used for TEMPORARY preferences.
  "availableDates"  date[] not null default '{}',
  "transportOnly"   boolean not null default false,
  "createdAt"       timestamptz not null default now()
);

create index "WorkerPreference_workerId_idx" on "WorkerPreference" ("workerId");

alter table "WorkerProfile"
  drop column if exists "employmentTypes",
  drop column if exists "minHourlyPay",
  drop column if exists "preferredShifts",
  drop column if exists "regions",
  drop column if exists "availableDates",
  drop column if exists "transportOnly";

-- Same temporary, permissive access as the other tables (see init_schema).
grant select on "WorkerPreference" to anon;
grant select, insert, update, delete on "WorkerPreference" to authenticated;
grant usage, select on sequence "WorkerPreference_id_seq" to authenticated;

alter table "WorkerPreference" enable row level security;
create policy "public read" on "WorkerPreference" for select to anon, authenticated using (true);
create policy "authenticated write" on "WorkerPreference" for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
