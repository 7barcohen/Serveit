-- WorkAway business logic. Everything a user can change goes through these
-- SECURITY DEFINER functions (called from the client with supabase.rpc), so the
-- rules below cannot be bypassed from the browser.
-- Errors are raised in Hebrew and shown to the user as-is.

-- Formatting helpers --------------------------------------------------------

create or replace function il_time(p_ts timestamptz) returns text
language sql immutable as $$
  select to_char(p_ts at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI')
$$;

-- Contact masking (anti-disintermediation) ----------------------------------

create or replace function mask_contact_info(p_text text) returns text
language sql immutable as $$
  select case when p_text is null then null else
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            p_text,
            -- e-mail addresses
            '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[הוסתר]', 'g'),
          -- links and bare domains
          '(https?://|www\.)\S+|\m[A-Za-z0-9-]+\.(com|co\.il|org\.il|org|net|io|me|ly|link|app|info)\M(/\S*)?',
          '[הוסתר]', 'gi'),
        -- phone numbers: 7+ digits, optionally separated by spaces, dashes or brackets
        '\+?\d([\s()-]*\d){6,}', '[הוסתר]', 'g'),
      -- code words for moving the conversation off the platform
      '(וואטסאפ|ווטסאפ|וואצאפ|ווצאפ|וטסאפ|וואטס\s?אפ|whats\s?app|wa\.me|טלגרם|telegram|signal|סיגנל|אינסטגרם|אינסטה|instagram|פייסבוק|facebook|תתקשר(י|ו)?\s+אלי(י)?|תחייג(י|ו)?\s+אלי(י)?|תתקשר(י|ו)?\s+ל(י|נו)|מספר\s+הטלפון\s+שלי|הטלפון\s+שלי|המספר\s+שלי|המייל\s+שלי)',
      '[הוסתר]', 'gi')
  end
$$;

create or replace function contains_contact_info(p_text text) returns boolean
language sql immutable as $$
  select p_text is not null and mask_contact_info(p_text) is distinct from p_text
$$;

create or replace function notify_user(
  p_user_id integer, p_type text, p_title text, p_body text default '',
  p_application_id integer default null, p_job_id integer default null
) returns void
language sql security definer set search_path = public as $$
  insert into "Notification" ("userId", "type", "title", "body", "applicationId", "jobId")
  values (p_user_id, p_type, p_title, coalesce(p_body, ''), p_application_id, p_job_id)
$$;

-- Each attempt is logged for the admin. The third one suspends the account.
create or replace function record_contact_violation(
  p_user_id integer, p_source text, p_text text, p_application_id integer default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into "ContactViolation" ("userId", "applicationId", "source", "originalText")
  values (p_user_id, p_application_id, p_source, p_text);

  update "User" set "contactViolations" = "contactViolations" + 1
  where id = p_user_id
  returning "contactViolations" into v_count;

  if v_count >= 3 then
    update "User" set
      "isSuspended" = true, "suspendedAt" = now(), "suspendedUntil" = null,
      "suspensionReason" = 'הפרות חוזרות של מדיניות העברת פרטי קשר'
    where id = p_user_id and not "isSuspended";
    perform notify_user(p_user_id, 'suspension', 'החשבון הושעה',
      'בעקבות ניסיונות חוזרים להעביר פרטי קשר מחוץ לפלטפורמה. לבירור יש לפנות לצוות WorkAway.');
  else
    perform notify_user(p_user_id, 'dlp_warning', 'אזהרה: אסור להעביר פרטי קשר',
      format('זוהה ניסיון להעביר פרטי קשר (%s מתוך 3). הפרה נוספת עלולה להוביל להשעיית החשבון.', v_count));
  end if;
end;
$$;

-- Israeli ID / company number (ח.פ. / עוסק מורשה) check digit.
create or replace function is_valid_israeli_id(p_value text) returns boolean
language plpgsql immutable as $$
declare
  v_digits text := lpad(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), 9, '0');
  v_sum integer := 0;
  v_step integer;
begin
  if length(regexp_replace(coalesce(p_value, ''), '\D', '', 'g')) not between 8 and 9 then
    return false;
  end if;
  for i in 1..9 loop
    v_step := substr(v_digits, i, 1)::integer * (case when i % 2 = 0 then 2 else 1 end);
    v_sum := v_sum + (case when v_step > 9 then v_step - 9 else v_step end);
  end loop;
  return v_sum % 10 = 0;
end;
$$;

-- Access helpers ------------------------------------------------------------

create or replace function is_blocked_between(p_a integer, p_b integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from "UserBlock"
    where ("blockerId" = p_a and "blockedId" = p_b) or ("blockerId" = p_b and "blockedId" = p_a)
  )
$$;

create or replace function is_application_participant(p_application_id integer) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from "Application" a join "Job" j on j.id = a."jobId"
    where a.id = p_application_id and app_user_id() in (a."workerId", j."employerId")
  )
$$;

-- Storage paths are '<applicationId>/<file>' for chat audio.
create or replace function can_access_chat_folder(p_object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_folder text := split_part(p_object_name, '/', 1);
begin
  if v_folder !~ '^\d+$' then
    return false;
  end if;
  return is_application_participant(v_folder::integer);
end;
$$;

create or replace function employer_has_access(p_employer_id integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from "EmployerProfile"
    where "userId" = p_employer_id
      and ("subscriptionStatus" = 'ACTIVE' or ("subscriptionStatus" = 'TRIAL' and "trialEndsAt" > now()))
  )
$$;

create or replace function require_employer_access(p_employer_id integer) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if app_user_role() is distinct from 'EMPLOYER' and not is_admin() then
    raise exception 'הפעולה זמינה למעסיקים בלבד';
  end if;
  if app_user_role() = 'EMPLOYER' and not employer_has_access(p_employer_id) then
    raise exception 'תקופת הניסיון הסתיימה. יש לבחור מסלול כדי להמשיך לפרסם ולגייס';
  end if;
end;
$$;

-- Reliability score (RS) -----------------------------------------------------

create or replace function apply_reliability_event(
  p_worker_id integer, p_type "ReliabilityEventType", p_application_id integer
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_delta integer := case p_type
    when 'NO_SHOW' then -35
    when 'CANCEL_UNDER_4H' then -20
    when 'CANCEL_4_TO_24H' then -10
    when 'CANCEL_OVER_24H' then 0
    when 'LATE_ARRIVAL' then -5
    when 'SHIFT_COMPLETED' then 2
    when 'STREAK_BONUS' then 10
  end;
begin
  insert into "ReliabilityEvent" ("workerId", "applicationId", "type", "delta")
  values (p_worker_id, p_application_id, p_type, v_delta);

  update "WorkerProfile" set
    "reliabilityScore" = greatest(0, "reliabilityScore" + v_delta),
    -- Only on-time completed shifts build the streak.
    "completedStreak" = case when p_type in ('SHIFT_COMPLETED', 'STREAK_BONUS') then "completedStreak" else 0 end
  where "userId" = p_worker_id;
end;
$$;

-- Matching, capacity and waitlist --------------------------------------------

create or replace function job_hired_count(p_job_id integer) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from "Application" where "jobId" = p_job_id and "stage" in ('HIRED', 'COMPLETED')
$$;

create or replace function post_system_message(p_application_id integer, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into "ChatMessage" ("applicationId", "senderId", "body") values (p_application_id, null, p_body)
$$;

-- A matched worker for a full job waits in line, unless their RS is under 70.
create or replace function move_to_waitlist(p_application_id integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_app "Application";
  v_score integer;
  v_title text;
begin
  select * into v_app from "Application" where id = p_application_id;
  select "reliabilityScore" into v_score from "WorkerProfile" where "userId" = v_app."workerId";
  select title into v_title from "Job" where id = v_app."jobId";

  if coalesce(v_score, 0) >= 70 then
    update "Application" set "stage" = 'WAITLISTED', "updatedAt" = now() where id = p_application_id;
    perform notify_user(v_app."workerId", 'waitlist', 'נכנסת לרשימת ההמתנה',
      format('המשרה "%s" התמלאה. אם יתפנה מקום, תקבל/י הצעה לפי מדד האמינות.', v_title), p_application_id, v_app."jobId");
  else
    update "Application" set "stage" = 'DECLINED', "updatedAt" = now(),
      "declineReason" = 'המשרה התמלאה, ומדד אמינות מתחת ל-70 אינו מאפשר רשימת המתנה'
    where id = p_application_id;
    perform notify_user(v_app."workerId", 'waitlist', 'המשרה התמלאה',
      format('המשרה "%s" התמלאה. מדד אמינות מתחת ל-70 אינו מאפשר להיכנס לרשימות המתנה.', v_title), p_application_id, v_app."jobId");
  end if;
end;
$$;

create or replace function refresh_job_capacity(p_job_id integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_job "Job";
  r record;
begin
  select * into v_job from "Job" where id = p_job_id for update;
  if v_job.id is null or v_job."status" = 'CLOSED' then
    return;
  end if;

  if job_hired_count(p_job_id) >= v_job."requiredWorkers" then
    if v_job."status" <> 'FILLED' then
      update "Job" set "status" = 'FILLED' where id = p_job_id;
      perform notify_user(v_job."employerId", 'job_filled', 'המשרה אוישה במלואה',
        format('"%s" סומנה כמלאה. מועמדים נוספים עברו לרשימת ההמתנה.', v_job.title), null, p_job_id);
    end if;
    for r in
      select id from "Application" where "jobId" = p_job_id and "stage" in ('MATCHED', 'OFFERED')
    loop
      update "JobOffer" set "status" = 'CANCELED', "respondedAt" = now()
      where "applicationId" = r.id and "status" = 'PENDING';
      perform move_to_waitlist(r.id);
    end loop;
  elsif v_job."status" = 'FILLED' then
    update "Job" set "status" = 'OPEN' where id = p_job_id;
  end if;
end;
$$;

create or replace function create_match(p_application_id integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_app "Application";
  v_job "Job";
  v_business text;
  v_worker_name text;
begin
  select * into v_app from "Application" where id = p_application_id;
  select * into v_job from "Job" where id = v_app."jobId";
  select "displayName" into v_business from "EmployerProfile" where "userId" = v_job."employerId";
  select split_part(trim("fullName"), ' ', 1) into v_worker_name from "WorkerProfile" where "userId" = v_app."workerId";

  update "Application" set "stage" = 'MATCHED', "matchedAt" = now(), "declineReason" = null, "updatedAt" = now()
  where id = p_application_id;

  perform post_system_message(p_application_id,
    'נוצר Match! הצ׳אט פתוח לתיאום. לשמירה על שני הצדדים, פרטי קשר (טלפון, מייל, קישורים) מוסתרים אוטומטית.');
  perform notify_user(v_app."workerId", 'match', 'יש Match!',
    format('%s מעוניינים בך למשרה "%s". אפשר להתחיל לדבר בצ׳אט.', v_business, v_job.title), p_application_id, v_job.id);
  perform notify_user(v_job."employerId", 'match', 'יש Match!',
    format('%s מתאים/ה למשרה "%s". אפשר להתחיל לדבר בצ׳אט.', v_worker_name, v_job.title), p_application_id, v_job.id);

  if v_job."status" = 'FILLED' then
    perform move_to_waitlist(p_application_id);
  end if;
end;
$$;

-- Offers the freed slot to the top of the waitlist (highest RS, then earliest
-- match) with 10 minutes to accept, reusing the canceled hire's terms.
create or replace function offer_next_from_waitlist(p_job_id integer, p_template_offer_id integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_template "JobOffer";
  v_next integer;
  v_business text;
  v_employer integer;
begin
  select * into v_template from "JobOffer" where id = p_template_offer_id;
  if v_template.id is null or v_template."startsAt" <= now() + interval '10 minutes' then
    return;
  end if;
  if exists (
    select 1 from "JobOffer" o join "Application" a on a.id = o."applicationId"
    where a."jobId" = p_job_id and o."status" = 'PENDING' and o."fromWaitlist"
  ) then
    return;
  end if;

  select a.id into v_next
  from "Application" a join "WorkerProfile" w on w."userId" = a."workerId"
  join "User" u on u.id = a."workerId"
  where a."jobId" = p_job_id and a."stage" = 'WAITLISTED' and w."reliabilityScore" >= 70 and not u."isSuspended"
  order by w."reliabilityScore" desc, a."matchedAt" asc
  limit 1
  for update of a skip locked;

  if v_next is null then
    return;
  end if;

  select j."employerId", e."displayName" into v_employer, v_business
  from "Job" j join "EmployerProfile" e on e."userId" = j."employerId" where j.id = p_job_id;

  insert into "JobOffer" ("applicationId", "startsAt", "endsAt", "address", "payType", "payAmount", "conditions", "expiresAt", "fromWaitlist")
  values (v_next, v_template."startsAt", v_template."endsAt", v_template."address", v_template."payType",
          v_template."payAmount", v_template."conditions", now() + interval '10 minutes', true);

  update "Application" set "stage" = 'OFFERED', "updatedAt" = now() where id = v_next;

  perform post_system_message(v_next,
    format('תקן התפנה למשמרת ב%s! אישור בתוך 10 דקות ישבץ אותך מיידית.', v_business));
  perform notify_user((select "workerId" from "Application" where id = v_next), 'waitlist_offer',
    format('תקן התפנה למשמרת ב%s!', v_business), 'אישור בתוך 10 דקות ישבץ אותך מיידית.', v_next, p_job_id);
end;
$$;

-- Profiles --------------------------------------------------------------------

create or replace function worker_profile_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_city "City";
begin
  if contains_contact_info(new."bio") and (tg_op = 'INSERT' or new."bio" is distinct from old."bio") then
    perform record_contact_violation(new."userId", 'profile', new."bio");
    new."bio" := mask_contact_info(new."bio");
  end if;
  if contains_contact_info(new."fullName") then
    new."fullName" := mask_contact_info(new."fullName");
  end if;

  -- Picking a city sets the location, unless coordinates were set explicitly
  -- in the same update (the "use my current location" button).
  if tg_op = 'INSERT' or (new."city" is distinct from old."city"
      and new."lat" is not distinct from old."lat" and new."lng" is not distinct from old."lng") then
    select * into v_city from "City" where "name" = new."city";
    if v_city."name" is not null then
      new."lat" := v_city."lat";
      new."lng" := v_city."lng";
      new."locationLabel" := v_city."name";
    end if;
  end if;
  return new;
end;
$$;

create trigger worker_profile_before_write
  before insert or update on "WorkerProfile"
  for each row execute function worker_profile_before_write();

create or replace function employer_profile_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if contains_contact_info(new."description") and (tg_op = 'INSERT' or new."description" is distinct from old."description") then
    perform record_contact_violation(new."userId", 'company_profile', new."description");
    new."description" := mask_contact_info(new."description");
  end if;
  if contains_contact_info(new."displayName") then
    new."displayName" := mask_contact_info(new."displayName");
  end if;
  if new."form101Url" is not null and new."form101Url" !~* '^https://' then
    raise exception 'קישור טופס 101 חייב להתחיל ב-https://';
  end if;
  return new;
end;
$$;

create trigger employer_profile_before_write
  before insert or update on "EmployerProfile"
  for each row execute function employer_profile_before_write();

create or replace function request_business_verification(
  p_business_id text, p_legal_name text, p_address text, p_representative_name text, p_representative_phone text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_phone text := regexp_replace(coalesce(p_representative_phone, ''), '[\s-]', '', 'g');
begin
  if app_user_role() <> 'EMPLOYER' then
    raise exception 'הפעולה זמינה למעסיקים בלבד';
  end if;
  if not is_valid_israeli_id(p_business_id) then
    raise exception 'מספר ח.פ. / עוסק מורשה אינו תקין';
  end if;
  if length(trim(coalesce(p_legal_name, ''))) < 2 then
    raise exception 'יש להזין שם חברה רשמי';
  end if;
  if length(trim(coalesce(p_address, ''))) < 5 then
    raise exception 'יש להזין כתובת פיזית מלאה';
  end if;
  if length(trim(coalesce(p_representative_name, ''))) < 2 then
    raise exception 'יש להזין שם נציג מורשה';
  end if;
  if v_phone !~ '^(\+972|0)\d{8,9}$' then
    raise exception 'מספר הטלפון של הנציג אינו תקין';
  end if;

  update "EmployerProfile" set
    "businessId" = regexp_replace(p_business_id, '\D', '', 'g'),
    "legalName" = trim(p_legal_name),
    "businessAddress" = trim(p_address),
    "representativeName" = trim(p_representative_name),
    "representativePhone" = v_phone,
    "verificationRequestedAt" = now(),
    "verificationNote" = null,
    "isVerified" = false
  where "userId" = v_me;
end;
$$;

create or replace function employer_public_profile(p_employer_id integer)
returns table (
  "userId" integer, "displayName" text, "description" text, "logoPath" text, "photoPaths" text[],
  "regions" "Region"[], "isVerified" boolean, "ratingAvg" numeric, "ratingCount" integer, "openJobs" integer
)
language sql stable security definer set search_path = public as $$
  select e."userId", e."displayName", e."description", e."logoPath", e."photoPaths", e."regions",
         e."isVerified", e."ratingAvg", e."ratingCount",
         (select count(*)::integer from "Job" j where j."employerId" = e."userId" and j."status" = 'OPEN')
  from "EmployerProfile" e
  where e."userId" = p_employer_id and auth.uid() is not null
$$;

-- Jobs ------------------------------------------------------------------------

create or replace function create_job(
  p_title text, p_category text, p_city text, p_employment_type "EmploymentType", p_date date,
  p_shift "ShiftWindow", p_pay_type "PayType", p_hourly_pay integer, p_monthly_pay integer,
  p_workload "Workload", p_required_workers integer, p_description text,
  p_transport_offered boolean, p_transport_from text
) returns "Job"
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_employer "EmployerProfile";
  v_limit integer;
  v_city "City";
  v_description text := trim(coalesce(p_description, ''));
  v_job "Job";
begin
  perform require_employer_access(v_me);
  select * into v_employer from "EmployerProfile" where "userId" = v_me;
  if v_employer.id is null then
    raise exception 'הפעולה זמינה למעסיקים בלבד';
  end if;
  if not v_employer."isVerified" then
    raise exception 'יש להשלים אימות עסק (ח.פ. / עוסק מורשה) לפני פרסום משרות';
  end if;

  if v_employer."activePlanId" is not null then
    select "openingsLimit" into v_limit from "EmployerPlan" where id = v_employer."activePlanId";
    if (select count(*) from "Job" where "employerId" = v_me and "status" <> 'CLOSED') >= v_limit then
      raise exception 'הגעת למכסת המשרות הפעילות במסלול שלך (%)', v_limit;
    end if;
  end if;

  if length(trim(coalesce(p_title, ''))) < 2 or length(p_title) > 120 then
    raise exception 'יש להזין כותרת משרה (עד 120 תווים)';
  end if;
  if not exists (select 1 from "JobCategory" where "name" = p_category and "isActive") then
    raise exception 'יש לבחור תחום עיסוק מהרשימה';
  end if;
  select * into v_city from "City" where "name" = p_city;
  if v_city."name" is null then
    raise exception 'יש לבחור עיר מהרשימה';
  end if;
  if p_date is null or (p_employment_type = 'TEMPORARY' and p_date < (now() at time zone 'Asia/Jerusalem')::date) then
    raise exception 'יש לבחור תאריך עתידי';
  end if;
  if p_pay_type = 'HOURLY' and coalesce(p_hourly_pay, 0) < 30 then
    raise exception 'שכר לשעה אינו תקין';
  end if;
  if p_pay_type = 'MONTHLY' and coalesce(p_monthly_pay, 0) < 1000 then
    raise exception 'שכר חודשי אינו תקין';
  end if;
  if p_employment_type = 'PERMANENT' and p_workload is null then
    raise exception 'יש לבחור היקף משרה (מלאה / חלקית)';
  end if;
  if coalesce(p_required_workers, 0) not between 1 and 500 then
    raise exception 'מספר העובדים הנדרש חייב להיות בין 1 ל-500';
  end if;

  if contains_contact_info(v_description) then
    perform record_contact_violation(v_me, 'job_description', v_description);
    v_description := mask_contact_info(v_description);
  end if;

  insert into "Job" (
    "title", "category", "city", "region", "lat", "lng", "employmentType", "date", "shift",
    "payType", "hourlyPay", "monthlyPay", "workload", "requiredWorkers", "description",
    "transportOffered", "transportFrom", "verifiedEmployer", "employerId"
  ) values (
    mask_contact_info(trim(p_title)), p_category, v_city."name", v_city."region", v_city."lat", v_city."lng",
    p_employment_type, p_date, p_shift,
    p_pay_type, case when p_pay_type = 'HOURLY' then p_hourly_pay end,
    case when p_pay_type = 'MONTHLY' then p_monthly_pay end,
    case when p_employment_type = 'PERMANENT' then p_workload end,
    p_required_workers, v_description,
    coalesce(p_transport_offered, false), nullif(trim(coalesce(p_transport_from, '')), ''), true, v_me
  ) returning * into v_job;

  -- Real-time alert to available workers whose saved preferences fit the job.
  insert into "Notification" ("userId", "type", "title", "body", "jobId")
  select distinct p."workerId", 'new_job', 'משרה חדשה שמתאימה לך',
         format('%s ב%s – %s', v_job.title, v_job.city, v_employer."displayName"), v_job.id
  from "WorkerPreference" p
  join "WorkerProfile" w on w."userId" = p."workerId"
  join "User" u on u.id = p."workerId"
  left join "City" pc on pc."name" = p."city"
  where p."employmentType" = p_employment_type
    and w."isAvailable" and not u."isSuspended"
    and (cardinality(p."categories") = 0 or p_category = any(p."categories"))
    and coalesce(distance_km(coalesce(pc."lat", w."lat"), coalesce(pc."lng", w."lng"), v_job."lat", v_job."lng"), 0) <= p."radiusKm"
    and not is_blocked_between(p."workerId", v_me)
  limit 500;

  return v_job;
end;
$$;

create or replace function close_job(p_job_id integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
begin
  if not exists (select 1 from "Job" where id = p_job_id and ("employerId" = v_me or is_admin())) then
    raise exception 'אין הרשאה לסגור משרה זו';
  end if;
  update "Job" set "status" = 'CLOSED' where id = p_job_id;
  update "JobOffer" o set "status" = 'CANCELED', "respondedAt" = now()
  from "Application" a
  where a.id = o."applicationId" and a."jobId" = p_job_id and o."status" = 'PENDING';
  update "Application" set "stage" = 'DECLINED', "declineReason" = 'המשרה נסגרה', "updatedAt" = now()
  where "jobId" = p_job_id and "stage" in ('LIKED', 'SHORTLISTED', 'MATCHED', 'OFFERED', 'WAITLISTED');
end;
$$;

-- Feeds -----------------------------------------------------------------------

-- Jobs the signed-in worker has not swiped yet. Flexible ranking against the
-- worker's preferences happens on the client; this only removes jobs that must
-- never be shown.
create or replace function job_feed()
returns table (
  "id" integer, "title" text, "category" text, "city" text, "region" "Region", "lat" double precision,
  "lng" double precision, "employmentType" "EmploymentType", "date" timestamptz, "shift" "ShiftWindow",
  "payType" "PayType", "hourlyPay" integer, "monthlyPay" integer, "workload" "Workload", "description" text,
  "transportOffered" boolean, "transportFrom" text, "requiredWorkers" integer, "hiredCount" integer,
  "status" "JobStatus", "isSponsored" boolean, "employerId" integer, "employerName" text,
  "employerLogoPath" text, "employerDescription" text, "employerVerified" boolean,
  "employerRatingAvg" numeric, "employerRatingCount" integer, "employerLowRating" boolean,
  "requiredLicense" text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_me integer := app_user_id();
  v_score integer;
begin
  if v_me is null then
    return;
  end if;
  select "reliabilityScore" into v_score from "WorkerProfile" where "userId" = v_me;

  return query
  select j.id, j.title, j.category, j.city, j.region, j.lat, j.lng, j."employmentType", j.date, j.shift,
         j."payType", j."hourlyPay", j."monthlyPay", j.workload, j.description,
         j."transportOffered", j."transportFrom", j."requiredWorkers", job_hired_count(j.id),
         j.status, coalesce(j."sponsoredUntil" > now(), false), j."employerId", e."displayName",
         e."logoPath", e.description, e."isVerified", e."ratingAvg", e."ratingCount",
         (e."ratingAvg" < 3.5 and e."ratingWarningAt" < now() - interval '7 days'),
         c."requiredLicense"
  from "Job" j
  join "EmployerProfile" e on e."userId" = j."employerId"
  join "User" eu on eu.id = j."employerId"
  left join "JobCategory" c on c."name" = j.category
  where j.status in ('OPEN', 'FILLED')
    and (j.status = 'OPEN' or coalesce(v_score, 0) >= 70)
    and (j."employmentType" = 'PERMANENT' or j.date::date >= (now() at time zone 'Asia/Jerusalem')::date)
    and not eu."isSuspended"
    and employer_has_access(j."employerId")
    and not is_blocked_between(v_me, j."employerId")
    and not exists (
      select 1 from "Application" a
      where a."jobId" = j.id and a."workerId" = v_me and (a."workerSwipe" is not null or a."matchedAt" is not null)
    );
end;
$$;

-- Candidates for one of the employer's jobs: workers whose preferences cover
-- the job type and field (or who are open to all fields), plus anyone who
-- already liked the job. Workers with RS under 70 always go to the bottom.
create or replace function candidate_feed(p_job_id integer)
returns table (
  "workerId" integer, "firstName" text, "age" integer, "city" text, "bio" text,
  "reliabilityScore" integer, "rating" numeric, "ratingCount" integer, "distanceKm" double precision,
  "categories" text[], "licenses" text[], "hasRequiredLicense" boolean, "likedJob" boolean,
  "isFlexible" boolean, "completedShifts" integer, "isSponsored" boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_me integer := app_user_id();
  v_job "Job";
  v_required text;
begin
  select * into v_job from "Job" where id = p_job_id;
  if v_job.id is null or (v_job."employerId" <> v_me and not is_admin()) then
    raise exception 'אין הרשאה לצפות במועמדים למשרה זו';
  end if;
  select "requiredLicense" into v_required from "JobCategory" where "name" = v_job.category;

  return query
  with prefs as (
    select p."workerId",
           array_agg(distinct cat) filter (where cat is not null) as cats,
           bool_or(cardinality(p."categories") = 0) as flexible,
           max(p."radiusKm") as radius
    from "WorkerPreference" p
    left join lateral unnest(p."categories") cat on true
    where p."employmentType" = v_job."employmentType"
    group by p."workerId"
  ),
  liked as (
    select a."workerId" from "Application" a where a."jobId" = p_job_id and a."workerSwipe" = 'RIGHT'
  )
  select w."userId", split_part(trim(w."fullName"), ' ', 1), w.age, w."locationLabel", w.bio,
         w."reliabilityScore", w.rating, w."ratingCount",
         round(distance_km(w.lat, w.lng, v_job.lat, v_job.lng)::numeric, 1)::double precision,
         coalesce(pr.cats, '{}'), coalesce(lic.names, '{}'),
         v_required is null or coalesce(v_required = any(lic.valid_names), false),
         l."workerId" is not null,
         coalesce(pr.flexible, true),
         (select count(*)::integer from "Application" x where x."workerId" = w."userId" and x.stage = 'COMPLETED'),
         coalesce(w."sponsoredUntil" > now(), false)
  from "WorkerProfile" w
  join "User" u on u.id = w."userId"
  left join prefs pr on pr."workerId" = w."userId"
  left join liked l on l."workerId" = w."userId"
  left join lateral (
    select array_agg(wl.name) as names,
           array_agg(wl.name) filter (where wl."expiresAt" is null or wl."expiresAt" >= current_date) as valid_names
    from "WorkerLicense" wl where wl."workerId" = w."userId"
  ) lic on true
  where u.role = 'WORKER'
    and not u."isSuspended"
    and w."isAvailable"
    and not is_blocked_between(v_me, w."userId")
    and not exists (
      select 1 from "Application" a
      where a."jobId" = p_job_id and a."workerId" = w."userId"
        and (a."employerSwipe" is not null or a."workerSwipe" = 'LEFT' or a."matchedAt" is not null)
    )
    and (
      l."workerId" is not null
      or (
        -- no saved preferences = open to everything
        (pr."workerId" is not null or not exists (select 1 from "WorkerPreference" p2 where p2."workerId" = w."userId"))
        and (pr."workerId" is null or pr.flexible or v_job.category = any(pr.cats))
        and coalesce(distance_km(w.lat, w.lng, v_job.lat, v_job.lng), 0) <= coalesce(pr.radius, 30) * 1.5 + 5
      )
    )
  order by (w."reliabilityScore" >= 70) desc,
           (l."workerId" is not null) desc,
           coalesce(w."sponsoredUntil" > now(), false) desc,
           w."reliabilityScore" desc,
           distance_km(w.lat, w.lng, v_job.lat, v_job.lng) asc nulls last
  limit 60;
end;
$$;

-- Swipes ----------------------------------------------------------------------

create or replace function swipe_job(p_job_id integer, p_direction "SwipeDirection")
returns "ApplicationStage"
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_job "Job";
  v_app "Application";
begin
  if app_user_role() <> 'WORKER' then
    raise exception 'רק עובדים יכולים להחליק על משרות';
  end if;
  select * into v_job from "Job" where id = p_job_id;
  if v_job.id is null or v_job.status = 'CLOSED' or is_blocked_between(v_me, v_job."employerId") then
    raise exception 'המשרה אינה זמינה יותר';
  end if;

  select * into v_app from "Application" where "jobId" = p_job_id and "workerId" = v_me for update;
  if v_app.id is null then
    insert into "Application" ("jobId", "workerId", "workerSwipe", "stage")
    values (p_job_id, v_me, p_direction, case when p_direction = 'RIGHT' then 'LIKED'::"ApplicationStage" else 'DECLINED'::"ApplicationStage" end)
    returning * into v_app;
  elsif v_app."matchedAt" is not null then
    raise exception 'כבר קיים Match למשרה זו';
  else
    update "Application" set "workerSwipe" = p_direction, "updatedAt" = now(),
      "stage" = case
        when p_direction = 'LEFT' or v_app."employerSwipe" = 'LEFT' then 'DECLINED'::"ApplicationStage"
        else 'LIKED'::"ApplicationStage" end
    where id = v_app.id returning * into v_app;
  end if;

  if p_direction = 'RIGHT' and v_app."employerSwipe" = 'RIGHT' then
    perform create_match(v_app.id);
  elsif p_direction = 'RIGHT' and v_app."employerSwipe" is null then
    perform notify_user(v_job."employerId", 'new_candidate', 'מועמד/ת חדש/ה התעניין/ה',
      format('מישהו סימן עניין במשרה "%s". אפשר לראות בכרטיסיות המועמדים.', v_job.title), v_app.id, p_job_id);
  end if;

  return (select "stage" from "Application" where id = v_app.id);
end;
$$;

create or replace function swipe_candidate(p_job_id integer, p_worker_id integer, p_direction "SwipeDirection")
returns "ApplicationStage"
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_job "Job";
  v_app "Application";
begin
  perform require_employer_access(v_me);
  select * into v_job from "Job" where id = p_job_id;
  if v_job.id is null or v_job."employerId" <> v_me then
    raise exception 'אין הרשאה למשרה זו';
  end if;
  if v_job.status = 'CLOSED' then
    raise exception 'המשרה סגורה';
  end if;
  if not exists (select 1 from "User" where id = p_worker_id and role = 'WORKER' and not "isSuspended")
     or is_blocked_between(v_me, p_worker_id) then
    raise exception 'המועמד/ת אינו/ה זמין/ה';
  end if;

  select * into v_app from "Application" where "jobId" = p_job_id and "workerId" = p_worker_id for update;
  if v_app.id is null then
    insert into "Application" ("jobId", "workerId", "employerSwipe", "stage")
    values (p_job_id, p_worker_id, p_direction, case when p_direction = 'RIGHT' then 'SHORTLISTED'::"ApplicationStage" else 'DECLINED'::"ApplicationStage" end)
    returning * into v_app;
  elsif v_app."matchedAt" is not null then
    raise exception 'כבר קיים Match עם המועמד/ת';
  else
    update "Application" set "employerSwipe" = p_direction, "updatedAt" = now(),
      "stage" = case
        when p_direction = 'LEFT' or v_app."workerSwipe" = 'LEFT' then 'DECLINED'::"ApplicationStage"
        when v_app."workerSwipe" = 'RIGHT' then v_app.stage
        else 'SHORTLISTED'::"ApplicationStage" end
    where id = v_app.id returning * into v_app;
  end if;

  if p_direction = 'RIGHT' and v_app."workerSwipe" = 'RIGHT' then
    perform create_match(v_app.id);
  end if;

  return (select "stage" from "Application" where id = v_app.id);
end;
$$;

-- Fast re-hire: offer work directly to someone who already worked for you,
-- even if their current preferences don't include this job.
create or replace function rehire_worker(p_worker_id integer, p_job_id integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_job "Job";
  v_app "Application";
begin
  perform require_employer_access(v_me);
  select * into v_job from "Job" where id = p_job_id;
  if v_job.id is null or v_job."employerId" <> v_me or v_job.status = 'CLOSED' then
    raise exception 'יש לבחור משרה פעילה שלך';
  end if;
  if not exists (
    select 1 from "Application" a join "Job" j on j.id = a."jobId"
    where a."workerId" = p_worker_id and j."employerId" = v_me and a.stage = 'COMPLETED'
  ) then
    raise exception 'גיוס חוזר זמין רק לעובדים שכבר עבדו אצלך';
  end if;
  if is_blocked_between(v_me, p_worker_id) or exists (select 1 from "User" where id = p_worker_id and "isSuspended") then
    raise exception 'העובד/ת אינו/ה זמין/ה';
  end if;

  select * into v_app from "Application" where "jobId" = p_job_id and "workerId" = p_worker_id for update;
  if v_app.id is not null and v_app.stage in ('MATCHED', 'OFFERED', 'HIRED', 'WAITLISTED') then
    raise exception 'העובד/ת כבר בתהליך למשרה זו';
  end if;
  if v_app.id is null then
    insert into "Application" ("jobId", "workerId", "employerSwipe", "stage")
    values (p_job_id, p_worker_id, 'RIGHT', 'SHORTLISTED') returning * into v_app;
  else
    update "Application" set "employerSwipe" = 'RIGHT', "canceledAt" = null, "canceledBy" = null,
      "cancellationReason" = null, "updatedAt" = now()
    where id = v_app.id;
  end if;

  perform create_match(v_app.id);
  perform post_system_message(v_app.id, 'המעסיק/ה הזמין/ה אותך לעבוד שוב, בזכות עבודה משותפת קודמת.');
  return v_app.id;
end;
$$;

-- Job offers --------------------------------------------------------------------

create or replace function send_job_offer(
  p_application_id integer, p_starts_at timestamptz, p_ends_at timestamptz, p_address text,
  p_pay_type "OfferPayType", p_pay_amount integer, p_conditions text, p_response_minutes integer
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_app "Application";
  v_job "Job";
  v_offer_id integer;
begin
  perform require_employer_access(v_me);
  select * into v_app from "Application" where id = p_application_id for update;
  select * into v_job from "Job" where id = v_app."jobId";
  if v_job.id is null or v_job."employerId" <> v_me then
    raise exception 'אין הרשאה למועמדות זו';
  end if;
  if v_app.stage <> 'MATCHED' then
    raise exception 'אפשר לשלוח הצעה רק למועמד/ת עם Match פעיל';
  end if;
  if v_job.status <> 'OPEN' then
    raise exception 'המשרה מלאה או סגורה';
  end if;
  if (select "form101Url" from "EmployerProfile" where "userId" = v_me) is null then
    raise exception 'יש להגדיר קישור לטופס 101 דיגיטלי בפרופיל החברה לפני שליחת הצעות';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'מועד ההתחלה חייב להיות בעתיד';
  end if;
  if p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'שעת הסיום חייבת להיות אחרי שעת ההתחלה';
  end if;
  if length(trim(coalesce(p_address, ''))) < 5 then
    raise exception 'יש להזין כתובת מדויקת';
  end if;
  if coalesce(p_pay_amount, 0) <= 0 then
    raise exception 'יש להזין תעריף';
  end if;
  if coalesce(p_response_minutes, 0) not between 10 and 4320 then
    raise exception 'זמן המענה חייב להיות בין 10 דקות ל-3 ימים';
  end if;

  insert into "JobOffer" ("applicationId", "startsAt", "endsAt", "address", "payType", "payAmount", "conditions", "expiresAt")
  values (p_application_id, p_starts_at, p_ends_at, trim(p_address), p_pay_type, p_pay_amount,
          mask_contact_info(trim(coalesce(p_conditions, ''))), now() + make_interval(mins => p_response_minutes))
  returning id into v_offer_id;

  update "Application" set "stage" = 'OFFERED', "updatedAt" = now() where id = p_application_id;

  perform post_system_message(p_application_id, format(
    'נשלחה הצעת עבודה רשמית: %s–%s, %s ₪%s. יש להשיב עד %s.',
    il_time(p_starts_at), to_char(p_ends_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
    case p_pay_type when 'HOURLY' then 'לשעה' else 'גלובלי' end, p_pay_amount,
    il_time(now() + make_interval(mins => p_response_minutes))));
  perform notify_user(v_app."workerId", 'offer', 'קיבלת הצעת עבודה!',
    format('%s – יש להשיב עד %s', v_job.title, il_time(now() + make_interval(mins => p_response_minutes))),
    p_application_id, v_job.id);
  return v_offer_id;
end;
$$;

create or replace function cancel_job_offer(p_offer_id integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_offer "JobOffer";
  v_app "Application";
begin
  select * into v_offer from "JobOffer" where id = p_offer_id for update;
  select * into v_app from "Application" where id = v_offer."applicationId" for update;
  if not exists (select 1 from "Job" where id = v_app."jobId" and "employerId" = v_me) then
    raise exception 'אין הרשאה להצעה זו';
  end if;
  if v_offer."status" <> 'PENDING' then
    raise exception 'ההצעה כבר אינה ממתינה';
  end if;
  update "JobOffer" set "status" = 'CANCELED', "respondedAt" = now() where id = p_offer_id;
  update "Application" set "updatedAt" = now(),
    "stage" = case when v_offer."fromWaitlist" then 'WAITLISTED'::"ApplicationStage" else 'MATCHED'::"ApplicationStage" end
  where id = v_app.id;
  perform post_system_message(v_app.id, 'המעסיק/ה ביטל/ה את הצעת העבודה.');
end;
$$;

create or replace function respond_job_offer(p_offer_id integer, p_accept boolean) returns "ApplicationStage"
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_offer "JobOffer";
  v_app "Application";
  v_job "Job";
  v_employer "EmployerProfile";
begin
  select * into v_offer from "JobOffer" where id = p_offer_id;
  select * into v_app from "Application" where id = v_offer."applicationId";
  if v_app.id is null or v_app."workerId" <> v_me then
    raise exception 'אין הרשאה להצעה זו';
  end if;
  -- Lock the job first so two acceptances can't both take the last slot.
  select * into v_job from "Job" where id = v_app."jobId" for update;
  select * into v_offer from "JobOffer" where id = p_offer_id for update;
  if v_offer."status" <> 'PENDING' then
    raise exception 'ההצעה כבר אינה בתוקף';
  end if;
  if v_offer."expiresAt" <= now() then
    raise exception 'פג תוקף ההצעה';
  end if;
  select * into v_employer from "EmployerProfile" where "userId" = v_job."employerId";

  if not p_accept then
    update "JobOffer" set "status" = 'DECLINED', "respondedAt" = now() where id = p_offer_id;
    if v_offer."fromWaitlist" then
      update "Application" set "stage" = 'DECLINED', "declineReason" = 'ויתור על מקום שהתפנה', "updatedAt" = now()
      where id = v_app.id;
      perform offer_next_from_waitlist(v_job.id, p_offer_id);
    else
      update "Application" set "stage" = 'MATCHED', "updatedAt" = now() where id = v_app.id;
    end if;
    perform post_system_message(v_app.id, 'ההצעה נדחתה על ידי העובד/ת.');
    perform notify_user(v_job."employerId", 'offer_declined', 'הצעת עבודה נדחתה',
      format('ההצעה למשרה "%s" נדחתה.', v_job.title), v_app.id, v_job.id);
    return (select "stage" from "Application" where id = v_app.id);
  end if;

  if v_job.status = 'CLOSED' then
    raise exception 'המשרה נסגרה';
  end if;
  if job_hired_count(v_job.id) >= v_job."requiredWorkers" then
    update "JobOffer" set "status" = 'CANCELED', "respondedAt" = now() where id = p_offer_id;
    perform move_to_waitlist(v_app.id);
    return (select "stage" from "Application" where id = v_app.id);
  end if;

  update "JobOffer" set "status" = 'ACCEPTED', "respondedAt" = now() where id = p_offer_id;
  update "Application" set "stage" = 'HIRED', "updatedAt" = now() where id = v_app.id;

  -- Automatic Form 101 link.
  insert into "DocumentDispatch" ("jobId", "documentUrl", "recipients")
  values (v_job.id, v_employer."form101Url", array[v_me]);
  perform post_system_message(v_app.id, format(
    'ההצעה אושרה! השיבוץ נקבע ל-%s בכתובת %s. להסדרת ההעסקה יש למלא טופס 101 דיגיטלי: %s',
    il_time(v_offer."startsAt"), v_offer.address, v_employer."form101Url"));
  perform notify_user(v_me, 'hired', 'שובצת למשמרת!',
    format('%s ב%s, %s. נשלח אליך קישור לטופס 101.', v_job.title, v_employer."displayName", il_time(v_offer."startsAt")),
    v_app.id, v_job.id);
  perform notify_user(v_job."employerId", 'offer_accepted', 'הצעת העבודה אושרה',
    format('המשרה "%s": העובד/ת אישר/ה את ההצעה.', v_job.title), v_app.id, v_job.id);

  perform refresh_job_capacity(v_job.id);
  return 'HIRED';
end;
$$;

-- Cancellations, completion, payments ---------------------------------------------

create or replace function cancel_hire(p_application_id integer, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_app "Application";
  v_job "Job";
  v_offer "JobOffer";
  v_by "CancellationActor";
  v_hours double precision;
begin
  select * into v_app from "Application" where id = p_application_id for update;
  select * into v_job from "Job" where id = v_app."jobId";
  if v_app.id is null then
    raise exception 'המועמדות לא נמצאה';
  end if;
  if v_app.stage <> 'HIRED' then
    raise exception 'אפשר לבטל רק שיבוץ פעיל';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 2 then
    raise exception 'יש לציין סיבת ביטול';
  end if;
  select * into v_offer from "JobOffer"
  where "applicationId" = v_app.id and "status" = 'ACCEPTED' order by "createdAt" desc limit 1;

  if v_me = v_app."workerId" then
    v_by := 'WORKER';
    if v_offer."startsAt" <= now() then
      raise exception 'המשמרת כבר התחילה, לא ניתן לבטל';
    end if;
    v_hours := extract(epoch from (v_offer."startsAt" - now())) / 3600;
    perform apply_reliability_event(v_me,
      case when v_hours < 4 then 'CANCEL_UNDER_4H'::"ReliabilityEventType"
           when v_hours < 24 then 'CANCEL_4_TO_24H'::"ReliabilityEventType"
           else 'CANCEL_OVER_24H'::"ReliabilityEventType" end,
      v_app.id);
    perform notify_user(v_job."employerId", 'hire_canceled', 'עובד/ת ביטל/ה הגעה',
      format('ביטול למשרה "%s": %s', v_job.title, trim(p_reason)), v_app.id, v_job.id);
  elsif v_me = v_job."employerId" then
    v_by := 'EMPLOYER';
    perform notify_user(v_app."workerId", 'hire_canceled', 'המעסיק/ה ביטל/ה את השיבוץ',
      format('המשרה "%s": %s', v_job.title, trim(p_reason)), v_app.id, v_job.id);
  elsif is_admin() then
    v_by := 'ADMIN';
  else
    raise exception 'אין הרשאה לבטל שיבוץ זה';
  end if;

  update "Application" set "stage" = 'CANCELED', "canceledAt" = now(), "canceledBy" = v_by,
    "cancellationReason" = mask_contact_info(trim(p_reason)), "updatedAt" = now()
  where id = v_app.id;
  perform post_system_message(v_app.id, 'השיבוץ בוטל. סיבה: ' || mask_contact_info(trim(p_reason)));

  perform refresh_job_capacity(v_job.id);
  if v_by = 'WORKER' then
    perform offer_next_from_waitlist(v_job.id, v_offer.id);
  end if;
end;
$$;

-- Employer confirms the outcome after the shift started:
-- 'COMPLETED' (+2, +10 bonus every 5 in a row), 'LATE' (-5), 'NO_SHOW' (-35 + 7 day suspension).
create or replace function complete_shift(p_application_id integer, p_outcome text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_app "Application";
  v_job "Job";
  v_offer "JobOffer";
  v_streak integer;
begin
  select * into v_app from "Application" where id = p_application_id for update;
  select * into v_job from "Job" where id = v_app."jobId";
  if v_job.id is null or (v_job."employerId" <> v_me and not is_admin()) then
    raise exception 'אין הרשאה';
  end if;
  if v_app.stage <> 'HIRED' then
    raise exception 'אפשר לעדכן תוצאה רק לשיבוץ פעיל';
  end if;
  select * into v_offer from "JobOffer"
  where "applicationId" = v_app.id and "status" = 'ACCEPTED' order by "createdAt" desc limit 1;
  if v_offer."startsAt" > now() then
    raise exception 'אפשר לסמן תוצאה רק אחרי תחילת המשמרת';
  end if;

  if p_outcome = 'COMPLETED' then
    update "Application" set "stage" = 'COMPLETED', "completedAt" = now(), "updatedAt" = now() where id = v_app.id;
    perform apply_reliability_event(v_app."workerId", 'SHIFT_COMPLETED', v_app.id);
    update "WorkerProfile" set "completedStreak" = "completedStreak" + 1
    where "userId" = v_app."workerId" returning "completedStreak" into v_streak;
    if v_streak >= 5 then
      perform apply_reliability_event(v_app."workerId", 'STREAK_BONUS', v_app.id);
      update "WorkerProfile" set "completedStreak" = 0 where "userId" = v_app."workerId";
    end if;
  elsif p_outcome = 'LATE' then
    update "Application" set "stage" = 'COMPLETED', "completedAt" = now(), "arrivedLate" = true, "updatedAt" = now()
    where id = v_app.id;
    perform apply_reliability_event(v_app."workerId", 'LATE_ARRIVAL', v_app.id);
  elsif p_outcome = 'NO_SHOW' then
    update "Application" set "stage" = 'NO_SHOW', "updatedAt" = now() where id = v_app.id;
    perform apply_reliability_event(v_app."workerId", 'NO_SHOW', v_app.id);
    update "User" set "isSuspended" = true, "suspendedAt" = now(), "suspendedUntil" = now() + interval '7 days',
      "suspensionReason" = 'אי-הגעה למשמרת ללא הודעה'
    where id = v_app."workerId";
    perform notify_user(v_app."workerId", 'suspension', 'החשבון הושעה ל-7 ימים',
      format('בעקבות אי-הגעה למשמרת "%s" ללא הודעה.', v_job.title), v_app.id, v_job.id);
    perform refresh_job_capacity(v_job.id);
    return;
  else
    raise exception 'תוצאה לא מוכרת';
  end if;

  perform notify_user(v_app."workerId", 'review_request', 'איך היה?',
    format('המשמרת "%s" הסתיימה. נשמח שתדרג/י את המעסיק.', v_job.title), v_app.id, v_job.id);
  perform notify_user(v_job."employerId", 'review_request', 'דרגו את העובד/ת',
    format('המשמרת "%s" הסתיימה. הדירוג עוזר לעובדים ולמעסיקים אחרים.', v_job.title), v_app.id, v_job.id);
end;
$$;

create or replace function record_payment(p_application_id integer, p_amount integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
begin
  if coalesce(p_amount, -1) < 0 then
    raise exception 'סכום לא תקין';
  end if;
  update "Application" a set "paidAmount" = p_amount, "updatedAt" = now()
  from "Job" j
  where a.id = p_application_id and j.id = a."jobId" and j."employerId" = v_me and a.stage = 'COMPLETED';
  if not found then
    raise exception 'אפשר לתעד תשלום רק למשמרת שהושלמה שלך';
  end if;
end;
$$;

-- Reviews ---------------------------------------------------------------------------

create or replace function submit_review(
  p_application_id integer, p_score integer, p_payment integer, p_environment integer,
  p_clarity integer, p_comment text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_app "Application";
  v_job "Job";
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_avg numeric;
  v_count integer;
begin
  select * into v_app from "Application" where id = p_application_id;
  select * into v_job from "Job" where id = v_app."jobId";
  if v_app.id is null or v_me not in (v_app."workerId", v_job."employerId") then
    raise exception 'אין הרשאה';
  end if;
  if v_app.stage <> 'COMPLETED' then
    raise exception 'אפשר לדרג רק אחרי משמרת שהושלמה';
  end if;
  if contains_contact_info(v_comment) then
    perform record_contact_violation(v_me, 'review', v_comment, v_app.id);
    v_comment := mask_contact_info(v_comment);
  end if;

  if v_me = v_app."workerId" then
    if coalesce(p_payment, 0) not between 1 and 5 or coalesce(p_environment, 0) not between 1 and 5
       or coalesce(p_clarity, 0) not between 1 and 5 then
      raise exception 'יש לדרג את שלושת הפרמטרים בין 1 ל-5';
    end if;
    insert into "ApplicationReview" ("applicationId", "reviewerId", "score", "paymentScore", "environmentScore", "clarityScore", "comment")
    values (v_app.id, v_me, round((p_payment + p_environment + p_clarity) / 3.0), p_payment, p_environment, p_clarity, v_comment)
    on conflict ("applicationId", "reviewerId") do update set
      "score" = excluded."score", "paymentScore" = excluded."paymentScore",
      "environmentScore" = excluded."environmentScore", "clarityScore" = excluded."clarityScore", "comment" = excluded."comment";

    select avg((r."paymentScore" + r."environmentScore" + r."clarityScore") / 3.0), count(*)
    into v_avg, v_count
    from "ApplicationReview" r join "Application" a on a.id = r."applicationId" join "Job" j on j.id = a."jobId"
    where j."employerId" = v_job."employerId" and r."reviewerId" = a."workerId";

    update "EmployerProfile" set "ratingAvg" = round(v_avg, 2), "ratingCount" = v_count,
      "ratingWarningAt" = case when v_avg < 3.5 then coalesce("ratingWarningAt", now()) end
    where "userId" = v_job."employerId";

    if v_avg < 3.5 and not exists (
      select 1 from "Notification" where "userId" = v_job."employerId" and "type" = 'rating_warning'
        and "createdAt" > now() - interval '7 days'
    ) then
      perform notify_user(v_job."employerId", 'rating_warning', 'הדירוג שלך ירד מתחת ל-3.5',
        'אם הדירוג הממוצע לא יעלה בתוך 7 ימים, חשיפת המשרות שלך בפיד תופחת.');
    end if;
  else
    if coalesce(p_score, 0) not between 1 and 5 then
      raise exception 'יש לבחור דירוג בין 1 ל-5';
    end if;
    insert into "ApplicationReview" ("applicationId", "reviewerId", "score", "comment")
    values (v_app.id, v_me, p_score, v_comment)
    on conflict ("applicationId", "reviewerId") do update set "score" = excluded."score", "comment" = excluded."comment";

    select avg(r.score), count(*) into v_avg, v_count
    from "ApplicationReview" r join "Application" a on a.id = r."applicationId"
    where a."workerId" = v_app."workerId" and r."reviewerId" <> a."workerId";

    update "WorkerProfile" set "rating" = round(v_avg, 2), "ratingCount" = v_count
    where "userId" = v_app."workerId";
  end if;
end;
$$;

-- Chat ------------------------------------------------------------------------------

create or replace function send_chat_message(p_application_id integer, p_body text, p_audio_path text default null)
returns "ChatMessage"
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_app "Application";
  v_job "Job";
  v_other integer;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_filtered boolean := false;
  v_message "ChatMessage";
begin
  select * into v_app from "Application" where id = p_application_id;
  select * into v_job from "Job" where id = v_app."jobId";
  if v_app.id is null or v_me not in (v_app."workerId", v_job."employerId") then
    raise exception 'אין הרשאה לצ׳אט זה';
  end if;
  if v_app.stage not in ('MATCHED', 'OFFERED', 'HIRED', 'WAITLISTED', 'COMPLETED') then
    raise exception 'הצ׳אט סגור';
  end if;
  v_other := case when v_me = v_app."workerId" then v_job."employerId" else v_app."workerId" end;
  if is_blocked_between(v_me, v_other) then
    raise exception 'לא ניתן לשלוח הודעות למשתמש זה';
  end if;
  if v_body is null and p_audio_path is null then
    raise exception 'ההודעה ריקה';
  end if;
  if length(v_body) > 2000 then
    raise exception 'ההודעה ארוכה מדי';
  end if;
  if p_audio_path is not null and split_part(p_audio_path, '/', 1) <> p_application_id::text then
    raise exception 'קובץ שמע לא תקין';
  end if;

  if contains_contact_info(v_body) then
    perform record_contact_violation(v_me, 'chat', v_body, v_app.id);
    v_body := mask_contact_info(v_body);
    v_filtered := true;
  end if;

  insert into "ChatMessage" ("applicationId", "senderId", "body", "audioPath", "wasFiltered")
  values (p_application_id, v_me, v_body, p_audio_path, v_filtered)
  returning * into v_message;

  -- One unread "new message" notification per conversation is enough.
  if not exists (
    select 1 from "Notification"
    where "userId" = v_other and "applicationId" = p_application_id and "type" = 'message' and "readAt" is null
  ) then
    perform notify_user(v_other, 'message', 'הודעה חדשה בצ׳אט', v_job.title, p_application_id, v_job.id);
  end if;

  return v_message;
end;
$$;

-- Trust & safety ----------------------------------------------------------------------

create or replace function report_user(
  p_reported_id integer, p_reason text, p_details text, p_application_id integer default null,
  p_message_id bigint default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_id integer;
begin
  if p_reported_id = v_me then
    raise exception 'לא ניתן לדווח על עצמך';
  end if;
  if p_application_id is not null and not is_application_participant(p_application_id) then
    raise exception 'אין הרשאה';
  end if;
  insert into "UserReport" ("reporterId", "reportedId", "applicationId", "messageId", "reason", "details")
  values (v_me, p_reported_id, p_application_id, p_message_id, trim(p_reason), trim(coalesce(p_details, '')))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function block_user(p_blocked_id integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
begin
  if p_blocked_id = v_me then
    raise exception 'לא ניתן לחסום את עצמך';
  end if;
  insert into "UserBlock" ("blockerId", "blockedId") values (v_me, p_blocked_id)
  on conflict do nothing;
  -- Stop any open process between the two (active hires stay; they can be canceled explicitly).
  update "JobOffer" o set "status" = 'CANCELED', "respondedAt" = now()
  from "Application" a join "Job" j on j.id = a."jobId"
  where o."applicationId" = a.id and o."status" = 'PENDING'
    and ((a."workerId" = v_me and j."employerId" = p_blocked_id) or (a."workerId" = p_blocked_id and j."employerId" = v_me));
  update "Application" a set "stage" = 'DECLINED', "declineReason" = 'חסימה', "updatedAt" = now()
  from "Job" j
  where j.id = a."jobId" and a."stage" in ('LIKED', 'SHORTLISTED', 'MATCHED', 'OFFERED', 'WAITLISTED')
    and ((a."workerId" = v_me and j."employerId" = p_blocked_id) or (a."workerId" = p_blocked_id and j."employerId" = v_me));
end;
$$;

-- Monetization ----------------------------------------------------------------------

create or replace function select_plan(p_plan_code text) returns "SubscriptionStatus"
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_plan_id integer;
  v_status "SubscriptionStatus";
begin
  if app_user_role() <> 'EMPLOYER' then
    raise exception 'הפעולה זמינה למעסיקים בלבד';
  end if;
  select id into v_plan_id from "EmployerPlan" where code = p_plan_code;
  if v_plan_id is null then
    raise exception 'מסלול לא קיים';
  end if;
  update "EmployerProfile" set
    "activePlanId" = v_plan_id,
    -- Payment collection is not integrated yet: after the trial the plan waits
    -- for an admin to confirm payment.
    "subscriptionStatus" = case
      when "subscriptionStatus" = 'TRIAL' and "trialEndsAt" > now() then 'TRIAL'::"SubscriptionStatus"
      when "subscriptionStatus" = 'ACTIVE' then 'ACTIVE'::"SubscriptionStatus"
      else 'PENDING_PAYMENT'::"SubscriptionStatus" end
  where "userId" = v_me
  returning "subscriptionStatus" into v_status;
  return v_status;
end;
$$;

create or replace function request_sponsorship(p_job_id integer, p_days integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_id integer;
begin
  if p_job_id is not null and not exists (select 1 from "Job" where id = p_job_id and "employerId" = v_me) then
    raise exception 'אין הרשאה למשרה זו';
  end if;
  if p_job_id is null and app_user_role() <> 'WORKER' then
    raise exception 'יש לבחור משרה לקידום';
  end if;
  if exists (
    select 1 from "SponsorshipRequest" where "requesterId" = v_me and "status" = 'PENDING'
      and "jobId" is not distinct from p_job_id
  ) then
    raise exception 'כבר קיימת בקשת קידום ממתינה';
  end if;
  insert into "SponsorshipRequest" ("requesterId", "jobId", "days") values (v_me, p_job_id, p_days)
  returning id into v_id;
  return v_id;
end;
$$;

-- Documents (existing manual flow, now limited to hired workers).
create or replace function send_documents(p_job_id integer, p_document_url text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_recipients integer[];
  r record;
begin
  if not exists (select 1 from "Job" where id = p_job_id and ("employerId" = v_me or is_admin())) then
    raise exception 'אין הרשאה למשרה זו';
  end if;
  if coalesce(p_document_url, '') !~* '^https://\S+$' then
    raise exception 'יש להזין קישור תקין שמתחיל ב-https://';
  end if;
  select array_agg("workerId") into v_recipients from "Application"
  where "jobId" = p_job_id and "stage" in ('HIRED', 'COMPLETED');
  if v_recipients is null then
    raise exception 'אפשר לשלוח מסמכים רק לעובדים משובצים';
  end if;
  insert into "DocumentDispatch" ("jobId", "documentUrl", "recipients") values (p_job_id, p_document_url, v_recipients);
  for r in select id from "Application" where "jobId" = p_job_id and "stage" in ('HIRED', 'COMPLETED') loop
    perform post_system_message(r.id, 'המעסיק/ה שלח/ה מסמכים: ' || p_document_url);
  end loop;
  return cardinality(v_recipients);
end;
$$;

-- Notifications -----------------------------------------------------------------------

create or replace function mark_notifications_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = public as $$
  update "Notification" set "readAt" = now()
  where "userId" = app_user_id() and "readAt" is null and (p_ids is null or id = any(p_ids))
$$;

-- Applications list for the signed-in user (worker or employer) -------------------------

create or replace function my_applications()
returns table (
  "id" integer, "jobId" integer, "workerId" integer, "employerId" integer, "stage" "ApplicationStage",
  "workerSwipe" "SwipeDirection", "employerSwipe" "SwipeDirection", "matchedAt" timestamptz,
  "canceledAt" timestamptz, "canceledBy" "CancellationActor", "cancellationReason" text,
  "arrivedLate" boolean, "completedAt" timestamptz, "paidAmount" integer, "declineReason" text,
  "createdAt" timestamptz,
  "jobTitle" text, "jobCategory" text, "jobCity" text, "jobDate" timestamptz, "jobShift" "ShiftWindow",
  "jobEmploymentType" "EmploymentType", "jobPayType" "PayType", "jobHourlyPay" integer, "jobMonthlyPay" integer,
  "jobStatus" "JobStatus", "jobRequiredWorkers" integer, "jobHiredCount" integer,
  "employerName" text, "employerLogoPath" text, "employerRatingAvg" numeric,
  "workerFirstName" text, "workerReliabilityScore" integer, "workerRating" numeric, "workerCity" text,
  "offerId" integer, "offerStatus" "OfferStatus", "offerStartsAt" timestamptz, "offerEndsAt" timestamptz,
  "offerAddress" text, "offerPayType" "OfferPayType", "offerPayAmount" integer, "offerConditions" text,
  "offerExpiresAt" timestamptz, "offerFromWaitlist" boolean,
  "waitlistPosition" integer, "lastMessageAt" timestamptz, "reviewedByMe" boolean
)
language sql stable security definer set search_path = public as $$
  with me as (select app_user_id() as id)
  select a.id, a."jobId", a."workerId", j."employerId", a.stage, a."workerSwipe", a."employerSwipe", a."matchedAt",
         a."canceledAt", a."canceledBy", a."cancellationReason", a."arrivedLate", a."completedAt", a."paidAmount",
         a."declineReason", a."createdAt",
         j.title, j.category, j.city, j.date, j.shift, j."employmentType", j."payType", j."hourlyPay", j."monthlyPay",
         j.status, j."requiredWorkers", job_hired_count(j.id),
         e."displayName", e."logoPath", e."ratingAvg",
         split_part(trim(w."fullName"), ' ', 1), w."reliabilityScore", w.rating, w."locationLabel",
         o.id, o.status, o."startsAt", o."endsAt", o.address, o."payType", o."payAmount", o.conditions,
         o."expiresAt", o."fromWaitlist",
         case when a.stage = 'WAITLISTED' then (
           select count(*)::integer + 1 from "Application" a2 join "WorkerProfile" w2 on w2."userId" = a2."workerId"
           where a2."jobId" = a."jobId" and a2.stage = 'WAITLISTED'
             and (w2."reliabilityScore" > w."reliabilityScore"
                  or (w2."reliabilityScore" = w."reliabilityScore" and a2."matchedAt" < a."matchedAt"))
         ) end,
         (select max(m."createdAt") from "ChatMessage" m where m."applicationId" = a.id),
         exists (select 1 from "ApplicationReview" r where r."applicationId" = a.id and r."reviewerId" = (select id from me))
  from "Application" a
  join "Job" j on j.id = a."jobId"
  join "EmployerProfile" e on e."userId" = j."employerId"
  join "WorkerProfile" w on w."userId" = a."workerId"
  left join lateral (
    select * from "JobOffer" o where o."applicationId" = a.id order by o."createdAt" desc limit 1
  ) o on true
  where (a."workerId" = (select id from me) and (a."workerSwipe" = 'RIGHT' or a."matchedAt" is not null))
     or (j."employerId" = (select id from me) and (a."matchedAt" is not null or a."employerSwipe" = 'RIGHT' or a."workerSwipe" = 'RIGHT'))
  order by coalesce(a."matchedAt", a."createdAt") desc
$$;

-- Admin ---------------------------------------------------------------------------------

create or replace function require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'הפעולה זמינה לאדמין בלבד';
  end if;
end;
$$;

create or replace function admin_decide_verification(p_user_id integer, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update "EmployerProfile" set "isVerified" = p_approve, "verificationNote" = nullif(trim(coalesce(p_note, '')), '')
  where "userId" = p_user_id;
  perform notify_user(p_user_id, 'verification',
    case when p_approve then 'העסק אומת בהצלחה' else 'אימות העסק נדחה' end,
    case when p_approve then 'אפשר להתחיל לפרסם משרות.' else coalesce(nullif(trim(p_note), ''), 'יש לעדכן את פרטי העסק ולשלוח שוב.') end);
end;
$$;

create or replace function admin_verify_worker(p_user_id integer, p_level "VerificationLevel") returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update "WorkerProfile" set "verificationLevel" = p_level where "userId" = p_user_id;
end;
$$;

create or replace function admin_verify_license(p_license_id integer, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update "WorkerLicense" set "isVerified" = p_verified where id = p_license_id;
end;
$$;

create or replace function admin_set_suspension(p_user_id integer, p_suspended boolean, p_reason text, p_days integer default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update "User" set
    "isSuspended" = p_suspended,
    "suspendedAt" = case when p_suspended then now() end,
    "suspendedUntil" = case when p_suspended and p_days is not null then now() + make_interval(days => p_days) end,
    "suspensionReason" = case when p_suspended then coalesce(nullif(trim(p_reason), ''), 'השעיה ע"י אדמין') end,
    "contactViolations" = case when p_suspended then "contactViolations" else 0 end
  where id = p_user_id;
  perform notify_user(p_user_id, 'suspension',
    case when p_suspended then 'החשבון הושעה' else 'ההשעיה הוסרה' end,
    case when p_suspended then coalesce(nullif(trim(p_reason), ''), '') else 'אפשר להמשיך להשתמש ב-WorkAway.' end);
end;
$$;

create or replace function admin_resolve_report(p_report_id integer, p_status "ReportStatus", p_suspend_reported boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_report "UserReport";
begin
  perform require_admin();
  update "UserReport" set "status" = p_status, "resolvedAt" = now(), "resolvedById" = app_user_id()
  where id = p_report_id returning * into v_report;
  if p_suspend_reported then
    perform admin_set_suspension(v_report."reportedId", true, 'בעקבות דיווח: ' || v_report.reason, null);
  end if;
end;
$$;

create or replace function admin_delete_message(p_message_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update "ChatMessage" set "body" = '[ההודעה הוסרה על ידי צוות WorkAway]', "audioPath" = null where id = p_message_id;
end;
$$;

create or replace function admin_decide_sponsorship(p_request_id integer, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_request "SponsorshipRequest";
begin
  perform require_admin();
  update "SponsorshipRequest" set "status" = case when p_approve then 'APPROVED'::"RequestStatus" else 'REJECTED'::"RequestStatus" end,
    "decidedAt" = now()
  where id = p_request_id and "status" = 'PENDING' returning * into v_request;
  if v_request.id is null then
    raise exception 'הבקשה כבר טופלה';
  end if;
  if p_approve then
    if v_request."jobId" is not null then
      update "Job" set "sponsoredUntil" = greatest(coalesce("sponsoredUntil", now()), now()) + make_interval(days => v_request.days)
      where id = v_request."jobId";
    else
      update "WorkerProfile" set "sponsoredUntil" = greatest(coalesce("sponsoredUntil", now()), now()) + make_interval(days => v_request.days)
      where "userId" = v_request."requesterId";
    end if;
  end if;
  perform notify_user(v_request."requesterId", 'sponsorship',
    case when p_approve then 'הקידום אושר' else 'בקשת הקידום נדחתה' end, '');
end;
$$;

create or replace function admin_set_subscription(p_user_id integer, p_status "SubscriptionStatus", p_trial_days integer default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update "EmployerProfile" set
    "subscriptionStatus" = p_status,
    "trialEndsAt" = case when p_trial_days is not null then now() + make_interval(days => p_trial_days) else "trialEndsAt" end
  where "userId" = p_user_id;
end;
$$;

create or replace function admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_completed integer;
  v_no_show integer;
begin
  perform require_admin();
  select count(*) filter (where stage = 'COMPLETED'), count(*) filter (where stage = 'NO_SHOW')
  into v_completed, v_no_show from "Application";
  return jsonb_build_object(
    'usersCount', (select count(*) from "User"),
    'workersCount', (select count(*) from "User" where role = 'WORKER'),
    'employersCount', (select count(*) from "User" where role = 'EMPLOYER'),
    'suspendedUsers', (select count(*) from "User" where "isSuspended"),
    'jobsCount', (select count(*) from "Job"),
    'openJobs', (select count(*) from "Job" where status = 'OPEN'),
    'filledJobs', (select count(*) from "Job" where status = 'FILLED'),
    'matchesCount', (select count(*) from "Application" where "matchedAt" is not null),
    'hiresCount', (select count(*) from "Application" where stage in ('HIRED', 'COMPLETED', 'NO_SHOW')),
    'completedShifts', v_completed,
    'noShows', v_no_show,
    'noShowRate', case when v_completed + v_no_show > 0 then round(v_no_show::numeric * 100 / (v_completed + v_no_show), 1) else 0 end,
    'pendingWorkers', (select count(*) from "WorkerProfile" where "verificationLevel" = 'BASIC'),
    'pendingEmployers', (select count(*) from "EmployerProfile" where "verificationRequestedAt" is not null and not "isVerified"),
    'openReports', (select count(*) from "UserReport" where status = 'OPEN'),
    'violationsLastWeek', (select count(*) from "ContactViolation" where "createdAt" > now() - interval '7 days'),
    'activeTrials', (select count(*) from "EmployerProfile" where "subscriptionStatus" = 'TRIAL' and "trialEndsAt" > now()),
    'pendingPayments', (select count(*) from "EmployerProfile" where "subscriptionStatus" = 'PENDING_PAYMENT'),
    'pendingSponsorships', (select count(*) from "SponsorshipRequest" where status = 'PENDING')
  );
end;
$$;

-- Scheduled processing (pg_cron every minute; clients also call it) ---------------------

create or replace function process_due_events() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  -- Expired offers. A regular offer goes back to "matched"; a waitlist offer
  -- moves on to the next person in line.
  for r in
    select o.*, a."jobId", a."workerId", j."employerId", j.title
    from "JobOffer" o join "Application" a on a.id = o."applicationId" join "Job" j on j.id = a."jobId"
    where o."status" = 'PENDING' and o."expiresAt" <= now()
    for update of o skip locked
  loop
    update "JobOffer" set "status" = 'EXPIRED', "respondedAt" = now() where id = r.id;
    if r."fromWaitlist" then
      update "Application" set "stage" = 'DECLINED', "declineReason" = 'לא התקבל אישור בזמן', "updatedAt" = now()
      where id = r."applicationId";
      perform post_system_message(r."applicationId", 'פג הזמן לאישור המקום שהתפנה. ההזדמנות עברה למועמד/ת הבא/ה בתור.');
      perform offer_next_from_waitlist(r."jobId", r.id);
    else
      update "Application" set "stage" = 'MATCHED', "updatedAt" = now()
      where id = r."applicationId" and "stage" = 'OFFERED';
      perform post_system_message(r."applicationId", 'פג תוקף הצעת העבודה.');
      perform notify_user(r."employerId", 'offer_expired', 'הצעת עבודה פגה',
        format('לא התקבלה תשובה להצעה למשרה "%s".', r.title), r."applicationId", r."jobId");
    end if;
  end loop;

  -- Timed suspensions (e.g. 7 days after a no-show).
  for r in
    update "User" set "isSuspended" = false, "suspendedAt" = null, "suspendedUntil" = null, "suspensionReason" = null
    where "isSuspended" and "suspendedUntil" is not null and "suspendedUntil" <= now()
    returning id
  loop
    perform notify_user(r.id, 'suspension', 'ההשעיה הסתיימה', 'אפשר לחזור לחפש משמרות.');
  end loop;

  -- Shift reminders 24 hours and 2 hours before start.
  for r in
    select o.id, o."startsAt", o.address, o."reminder24SentAt", a.id as app_id, a."workerId", a."jobId", j.title
    from "JobOffer" o join "Application" a on a.id = o."applicationId" join "Job" j on j.id = a."jobId"
    where o."status" = 'ACCEPTED' and a.stage = 'HIRED' and o."startsAt" > now()
      and ((o."reminder24SentAt" is null and o."startsAt" <= now() + interval '24 hours')
        or (o."reminder2SentAt" is null and o."startsAt" <= now() + interval '2 hours'))
  loop
    if r."startsAt" <= now() + interval '2 hours' then
      perform notify_user(r."workerId", 'reminder', 'המשמרת מתחילה בעוד פחות משעתיים',
        format('%s, %s, %s', r.title, il_time(r."startsAt"), r.address), r.app_id, r."jobId");
      update "JobOffer" set "reminder2SentAt" = now(), "reminder24SentAt" = coalesce("reminder24SentAt", now()) where id = r.id;
    else
      perform notify_user(r."workerId", 'reminder', 'תזכורת: משמרת מחר',
        format('%s, %s, %s', r.title, il_time(r."startsAt"), r.address), r.app_id, r."jobId");
      update "JobOffer" set "reminder24SentAt" = now() where id = r.id;
    end if;
  end loop;

  -- Free trials that ended.
  for r in
    update "EmployerProfile" set "subscriptionStatus" = case when "activePlanId" is not null
      then 'PENDING_PAYMENT'::"SubscriptionStatus" else 'EXPIRED'::"SubscriptionStatus" end
    where "subscriptionStatus" = 'TRIAL' and "trialEndsAt" <= now()
    returning "userId"
  loop
    perform notify_user(r."userId", 'subscription', 'תקופת הניסיון הסתיימה',
      'כדי להמשיך לפרסם משרות ולגייס יש לבחור מסלול.');
  end loop;
end;
$$;
