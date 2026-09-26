-- Identity: link Supabase Auth users to app users, provision app users in the
-- database (not from the browser), and helpers used by RLS policies and RPCs.

alter table "User"
  add column "authId"            uuid unique references auth.users(id) on delete cascade,
  add column "suspendedUntil"    timestamptz,
  add column "contactViolations" integer not null default 0;

-- Rows created by the old client-side flow were matched to Auth users by email.
update "User" u
set "authId" = a.id
from auth.users a
where lower(a.email) = lower(u.email) and u."authId" is null;

create or replace function app_user_id() returns integer
language sql stable security definer set search_path = public as $$
  select id from "User" where "authId" = auth.uid()
$$;

create or replace function app_user_role() returns "UserRole"
language sql stable security definer set search_path = public as $$
  select role from "User" where "authId" = auth.uid()
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'ADMIN' from "User" where "authId" = auth.uid()), false)
$$;

-- Returns the caller's app user id, or raises if not signed in / suspended.
create or replace function require_active_user() returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_user "User";
begin
  select * into v_user from "User" where "authId" = auth.uid();
  if v_user.id is null then
    raise exception 'יש להתחבר מחדש';
  end if;
  if v_user."isSuspended" then
    raise exception 'החשבון מושעה%', coalesce(' עד ' || to_char(v_user."suspendedUntil" at time zone 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI'), '');
  end if;
  return v_user.id;
end;
$$;

-- Creates the app user + profile for a Supabase Auth user. Admin can never be
-- self-assigned through sign-up metadata.
create or replace function provision_app_user(p_auth_id uuid, p_email text, p_meta jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_role "UserRole" := case v_meta->>'role' when 'employer' then 'EMPLOYER'::"UserRole" else 'WORKER'::"UserRole" end;
  v_user_id integer;
begin
  update "User" set "authId" = p_auth_id
  where lower(email) = lower(p_email) and "authId" is null
  returning id into v_user_id;
  if v_user_id is not null then
    return v_user_id;
  end if;

  insert into "User" (email, role, "authId")
  values (p_email, v_role, p_auth_id)
  returning id into v_user_id;

  if v_role = 'WORKER' then
    insert into "WorkerProfile" ("userId", "fullName", age, city)
    values (
      v_user_id,
      coalesce(nullif(trim(v_meta->>'fullName'), ''), split_part(p_email, '@', 1)),
      case when v_meta->>'age' ~ '^\d{1,3}$' then (v_meta->>'age')::integer else 18 end,
      coalesce(nullif(trim(v_meta->>'city'), ''), 'תל אביב')
    );
  else
    insert into "EmployerProfile" ("userId", "displayName")
    values (v_user_id, coalesce(nullif(trim(v_meta->>'displayName'), ''), split_part(p_email, '@', 1)));
  end if;

  return v_user_id;
end;
$$;

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform provision_app_user(new.id, new.email, new.raw_user_meta_data);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Auth users that signed up while the app tables were missing never got an app user.
select provision_app_user(a.id, a.email, a.raw_user_meta_data)
from auth.users a
where not exists (select 1 from "User" u where u."authId" = a.id);
