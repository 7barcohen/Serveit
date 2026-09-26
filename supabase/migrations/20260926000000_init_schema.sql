-- Serveit initial schema for Supabase.
-- Mirrors prisma/schema.prisma, keeping the quoted PascalCase table/column names
-- that src/api.ts queries (e.g. "User", "hourlyPay").
-- Run in Supabase Dashboard -> SQL Editor, or with `supabase db push`.

-- Enums ---------------------------------------------------------------------

create type "UserRole" as enum ('WORKER', 'EMPLOYER', 'ADMIN');
create type "VerificationLevel" as enum ('BASIC', 'VERIFIED');
create type "ShiftWindow" as enum ('MORNING', 'AFTERNOON', 'EVENING', 'NIGHT');
create type "ApplicationState" as enum ('PENDING', 'APPROVED', 'REJECTED');
create type "CancellationActor" as enum ('WORKER', 'EMPLOYER', 'ADMIN');

-- Tables --------------------------------------------------------------------

create table "User" (
  "id"               serial primary key,
  "email"            text not null unique,
  "passwordHash"     text not null default 'supabase-auth',
  "role"             "UserRole" not null,
  "isSuspended"      boolean not null default false,
  "suspensionReason" text,
  "suspendedAt"      timestamptz,
  "createdAt"        timestamptz not null default now(),
  "updatedAt"        timestamptz not null default now()
);

create table "EmployerPlan" (
  "id"            serial primary key,
  "code"          text not null unique,
  "name"          text not null,
  "monthlyPrice"  integer not null,
  "openingsLimit" integer not null,
  "features"      text[] not null default '{}'
);

create table "WorkerProfile" (
  "id"                serial primary key,
  "userId"            integer not null unique references "User"("id") on delete cascade,
  "fullName"          text not null,
  "age"               integer not null,
  "city"              text not null,
  "rating"            numeric(3, 2) not null default 0,
  "verificationLevel" "VerificationLevel" not null default 'BASIC',
  "tags"              text[] not null default '{}'
);

create table "EmployerProfile" (
  "id"           serial primary key,
  "userId"       integer not null unique references "User"("id") on delete cascade,
  "displayName"  text not null,
  "isVerified"   boolean not null default false,
  "activePlanId" integer references "EmployerPlan"("id")
);

create table "Job" (
  "id"               serial primary key,
  "title"            text not null,
  "category"         text not null,
  "city"             text not null,
  "date"             timestamptz not null,
  "shift"            "ShiftWindow" not null,
  "hourlyPay"        integer not null,
  "description"      text not null,
  "transportOffered" boolean not null default false,
  "transportFrom"    text,
  "verifiedEmployer" boolean not null default false,
  "employerId"       integer not null references "User"("id") on delete cascade,
  "createdAt"        timestamptz not null default now()
);

create table "Application" (
  "id"                 serial primary key,
  "jobId"              integer not null references "Job"("id") on delete cascade,
  "workerId"           integer not null references "User"("id") on delete cascade,
  "state"              "ApplicationState" not null default 'PENDING',
  "canceledAt"         timestamptz,
  "canceledBy"         "CancellationActor",
  "cancellationReason" text,
  "penaltyPoints"      integer not null default 0,
  "createdAt"          timestamptz not null default now(),
  "updatedAt"          timestamptz not null default now(),
  unique ("jobId", "workerId")
);

create table "ApplicationReview" (
  "id"            serial primary key,
  "applicationId" integer not null references "Application"("id") on delete cascade,
  "reviewerId"    integer not null references "User"("id") on delete cascade,
  "score"         integer not null,
  "comment"       text,
  "createdAt"     timestamptz not null default now(),
  unique ("applicationId", "reviewerId")
);

create table "DocumentDispatch" (
  "id"          serial primary key,
  "jobId"       integer not null,
  "documentUrl" text not null,
  "recipients"  integer[] not null default '{}',
  "sentAt"      timestamptz not null default now()
);

-- Prisma's @updatedAt was set by the ORM; in Supabase a trigger does it.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

create trigger user_set_updated_at before update on "User"
  for each row execute function set_updated_at();
create trigger application_set_updated_at before update on "Application"
  for each row execute function set_updated_at();

-- Seed plans (ensureAppUser assigns new employers the 'starter' plan) -------

insert into "EmployerPlan" ("code", "name", "monthlyPrice", "openingsLimit", "features") values
  ('starter', 'Starter', 50, 5,  array['פרסום משרות בסיסי', 'צפייה בפרופילי עובדים', 'ניהול מסמכים בקישור']),
  ('pro',     'Pro',     80, 20, array['הבלטת משרות', 'סינון מתקדם לפי דירוג', 'תבניות מסמכים מהירות']),
  ('scale',   'Scale',   80, 60, array['חשבון צוות', 'יצוא דוחות', 'תמיכת עדיפות גבוהה'])
on conflict ("code") do nothing;

-- Access --------------------------------------------------------------------
-- TEMPORARY, PERMISSIVE POLICIES: they match what the client currently does
-- (anonymous bootstrap reads, all writes from the browser) but do NOT enforce
-- role/ownership rules. Any logged-in user can write any row. Replace with
-- ownership-based policies before real users are on the platform.

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'User', 'EmployerPlan', 'WorkerProfile', 'EmployerProfile',
    'Job', 'Application', 'ApplicationReview', 'DocumentDispatch'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    execute format('create policy "authenticated write" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end;
$$;

-- Make PostgREST pick up the new tables immediately (fixes PGRST205).
notify pgrst, 'reload schema';
