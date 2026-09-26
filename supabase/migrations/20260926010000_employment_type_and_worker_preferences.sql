-- Temporary vs. permanent jobs, job regions, and worker search preferences
-- (previously kept only in the browser's localStorage).
-- Run in Supabase Dashboard -> SQL Editor after 20260926000000_init_schema.sql.

create type "EmploymentType" as enum ('TEMPORARY', 'PERMANENT');
create type "Region" as enum (
  'NORTH', 'HAIFA', 'SHARON', 'CENTER', 'TEL_AVIV', 'JERUSALEM', 'SHFELA', 'SOUTH'
);

-- Existing jobs are one-off shifts, so they default to TEMPORARY.
-- For PERMANENT jobs, "date" is the start date.
alter table "Job"
  add column "employmentType" "EmploymentType" not null default 'TEMPORARY',
  add column "region"         "Region";

-- Empty arrays mean "no restriction".
-- "availableDates" only applies to TEMPORARY jobs.
alter table "WorkerProfile"
  add column "employmentTypes" "EmploymentType"[] not null default '{TEMPORARY,PERMANENT}',
  add column "minHourlyPay"    integer not null default 35,
  add column "preferredShifts" "ShiftWindow"[] not null default '{}',
  add column "regions"         "Region"[] not null default '{}',
  add column "availableDates"  date[] not null default '{}',
  add column "transportOnly"   boolean not null default false;

notify pgrst, 'reload schema';
