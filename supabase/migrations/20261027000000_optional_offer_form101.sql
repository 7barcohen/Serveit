-- Form 101 is optional and may be specified separately on each offer.
-- Run after 20260927000300_access_policies.sql.

begin;

alter table public."JobOffer"
  add column if not exists "form101Url" text;

-- Prevent callers from using the previous offer RPC which required the profile URL.
revoke execute on function public.send_job_offer(
  integer, timestamptz, timestamptz, text, public."OfferPayType", integer, text, integer
) from authenticated;
revoke execute on function public.send_job_offer(
  integer, timestamptz, timestamptz, text, public."OfferPayType", integer, text, integer
) from public, anon;

create or replace function public.send_job_offer(
  p_application_id integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_address text,
  p_pay_type public."OfferPayType",
  p_pay_amount integer,
  p_conditions text,
  p_response_minutes integer,
  p_form101_url text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_app public."Application";
  v_job public."Job";
  v_offer_id integer;
  v_form101_url text := nullif(trim(coalesce(p_form101_url, '')), '');
begin
  perform require_employer_access(v_me);
  select * into v_app from public."Application" where id = p_application_id for update;
  select * into v_job from public."Job" where id = v_app."jobId";
  if v_job.id is null or v_job."employerId" <> v_me then
    raise exception 'אין הרשאה למועמדות זו';
  end if;
  if v_app.stage <> 'MATCHED' then
    raise exception 'אפשר לשלוח הצעה רק למועמד/ת עם Match פעיל';
  end if;
  if v_job.status <> 'OPEN' then
    raise exception 'המשרה מלאה או סגורה';
  end if;
  if v_form101_url is not null and v_form101_url !~* '^https://\S+$' then
    raise exception 'קישור טופס 101 חייב להתחיל ב-https://';
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

  insert into public."JobOffer" (
    "applicationId", "startsAt", "endsAt", address, "payType", "payAmount",
    conditions, "expiresAt", "form101Url"
  ) values (
    p_application_id, p_starts_at, p_ends_at, trim(p_address), p_pay_type, p_pay_amount,
    mask_contact_info(trim(coalesce(p_conditions, ''))),
    now() + make_interval(mins => p_response_minutes), v_form101_url
  ) returning id into v_offer_id;

  update public."Application" set stage = 'OFFERED', "updatedAt" = now()
  where id = p_application_id;

  perform post_system_message(p_application_id, format(
    'נשלחה הצעת עבודה רשמית: %s–%s, %s ₪%s. יש להשיב עד %s.%s',
    il_time(p_starts_at), to_char(p_ends_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
    case p_pay_type when 'HOURLY' then 'לשעה' else 'גלובלי' end, p_pay_amount,
    il_time(now() + make_interval(mins => p_response_minutes)),
    case when v_form101_url is not null then ' קישור לטופס 101 יופיע בהצעה.' else '' end
  ));
  perform notify_user(v_app."workerId", 'offer', 'קיבלת הצעת עבודה!',
    format('%s – יש להשיב עד %s', v_job.title, il_time(now() + make_interval(mins => p_response_minutes))),
    p_application_id, v_job.id);
  return v_offer_id;
end;
$$;

grant execute on function public.send_job_offer(
  integer, timestamptz, timestamptz, text, public."OfferPayType", integer, text, integer, text
) to authenticated;
revoke execute on function public.send_job_offer(
  integer, timestamptz, timestamptz, text, public."OfferPayType", integer, text, integer, text
) from public, anon;

create or replace function public.respond_job_offer(p_offer_id integer, p_accept boolean)
returns public."ApplicationStage"
language plpgsql security definer set search_path = public as $$
declare
  v_me integer := require_active_user();
  v_offer public."JobOffer";
  v_app public."Application";
  v_job public."Job";
  v_employer public."EmployerProfile";
begin
  select * into v_offer from public."JobOffer" where id = p_offer_id;
  select * into v_app from public."Application" where id = v_offer."applicationId";
  if v_app.id is null or v_app."workerId" <> v_me then
    raise exception 'אין הרשאה להצעה זו';
  end if;
  -- Lock the job first so two acceptances can't both take the last slot.
  select * into v_job from public."Job" where id = v_app."jobId" for update;
  select * into v_offer from public."JobOffer" where id = p_offer_id for update;
  if v_offer.status <> 'PENDING' then
    raise exception 'ההצעה כבר אינה בתוקף';
  end if;
  if v_offer."expiresAt" <= now() then
    raise exception 'פג תוקף ההצעה';
  end if;
  select * into v_employer from public."EmployerProfile" where "userId" = v_job."employerId";

  if not p_accept then
    update public."JobOffer" set status = 'DECLINED', "respondedAt" = now() where id = p_offer_id;
    if v_offer."fromWaitlist" then
      update public."Application" set stage = 'DECLINED', "declineReason" = 'ויתור על מקום שהתפנה', "updatedAt" = now()
      where id = v_app.id;
      perform offer_next_from_waitlist(v_job.id, p_offer_id);
    else
      update public."Application" set stage = 'MATCHED', "updatedAt" = now() where id = v_app.id;
    end if;
    perform post_system_message(v_app.id, 'ההצעה נדחתה על ידי העובד/ת.');
    perform notify_user(v_job."employerId", 'offer_declined', 'הצעת עבודה נדחתה',
      format('ההצעה למשרה "%s" נדחתה.', v_job.title), v_app.id, v_job.id);
    return (select stage from public."Application" where id = v_app.id);
  end if;

  if v_job.status = 'CLOSED' then
    raise exception 'המשרה נסגרה';
  end if;
  if job_hired_count(v_job.id) >= v_job."requiredWorkers" then
    update public."JobOffer" set status = 'CANCELED', "respondedAt" = now() where id = p_offer_id;
    perform move_to_waitlist(v_app.id);
    return (select stage from public."Application" where id = v_app.id);
  end if;

  update public."JobOffer" set status = 'ACCEPTED', "respondedAt" = now() where id = p_offer_id;
  update public."Application" set stage = 'HIRED', "updatedAt" = now() where id = v_app.id;

  -- A document dispatch is created only when the employer attached a Form 101 URL.
  if v_offer."form101Url" is not null then
    insert into public."DocumentDispatch" ("jobId", "documentUrl", recipients)
    values (v_job.id, v_offer."form101Url", array[v_me]);
    perform post_system_message(v_app.id, format(
      'ההצעה אושרה! השיבוץ נקבע ל-%s בכתובת %s. קישור לטופס 101: %s',
      il_time(v_offer."startsAt"), v_offer.address, v_offer."form101Url"));
  else
    perform post_system_message(v_app.id, format(
      'ההצעה אושרה! השיבוץ נקבע ל-%s בכתובת %s. לא צורף להצעה טופס 101.',
      il_time(v_offer."startsAt"), v_offer.address));
  end if;

  perform notify_user(v_me, 'hired', 'שובצת למשמרת!',
    format('%s ב%s, %s.%s', v_job.title, v_employer."displayName", il_time(v_offer."startsAt"),
      case when v_offer."form101Url" is not null then ' נשלח אליך קישור לטופס 101.' else '' end),
    v_app.id, v_job.id);
  perform notify_user(v_job."employerId", 'offer_accepted', 'הצעת העבודה אושרה',
    format('המשרה "%s": העובד/ת אישר/ה את ההצעה.', v_job.title), v_app.id, v_job.id);

  perform refresh_job_capacity(v_job.id);
  return 'HIRED';
end;
$$;

revoke execute on function public.respond_job_offer(integer, boolean) from public, anon;
grant execute on function public.respond_job_offer(integer, boolean) to authenticated;

-- Extend the application RPC result with the optional URL shown in offer cards.
drop function public.my_applications();

create function public.my_applications()
returns table (
  "id" integer, "jobId" integer, "workerId" integer, "employerId" integer, "stage" public."ApplicationStage",
  "workerSwipe" public."SwipeDirection", "employerSwipe" public."SwipeDirection", "matchedAt" timestamptz,
  "canceledAt" timestamptz, "canceledBy" public."CancellationActor", "cancellationReason" text,
  "arrivedLate" boolean, "completedAt" timestamptz, "paidAmount" integer, "declineReason" text,
  "createdAt" timestamptz,
  "jobTitle" text, "jobCategory" text, "jobCity" text, "jobDate" timestamptz, "jobShift" public."ShiftWindow",
  "jobEmploymentType" public."EmploymentType", "jobPayType" public."PayType", "jobHourlyPay" integer, "jobMonthlyPay" integer,
  "jobStatus" public."JobStatus", "jobRequiredWorkers" integer, "jobHiredCount" integer,
  "employerName" text, "employerLogoPath" text, "employerRatingAvg" numeric,
  "workerFirstName" text, "workerReliabilityScore" integer, "workerRating" numeric, "workerCity" text,
  "offerId" integer, "offerStatus" public."OfferStatus", "offerStartsAt" timestamptz, "offerEndsAt" timestamptz,
  "offerAddress" text, "offerPayType" public."OfferPayType", "offerPayAmount" integer, "offerConditions" text,
  "offerExpiresAt" timestamptz, "offerFromWaitlist" boolean, "offerForm101Url" text,
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
         o."expiresAt", o."fromWaitlist", o."form101Url",
         case when a.stage = 'WAITLISTED' then (
           select count(*)::integer + 1 from public."Application" a2
           join public."WorkerProfile" w2 on w2."userId" = a2."workerId"
           where a2."jobId" = a."jobId" and a2.stage = 'WAITLISTED'
             and (w2."reliabilityScore" > w."reliabilityScore"
                  or (w2."reliabilityScore" = w."reliabilityScore" and a2."matchedAt" < a."matchedAt"))
         ) end,
         (select max(m."createdAt") from public."ChatMessage" m where m."applicationId" = a.id),
         exists (select 1 from public."ApplicationReview" r
                 where r."applicationId" = a.id and r."reviewerId" = (select id from me))
  from public."Application" a
  join public."Job" j on j.id = a."jobId"
  join public."EmployerProfile" e on e."userId" = j."employerId"
  join public."WorkerProfile" w on w."userId" = a."workerId"
  left join lateral (
    select * from public."JobOffer" o
    where o."applicationId" = a.id
    order by o."createdAt" desc limit 1
  ) o on true
  where (a."workerId" = (select id from me) and (a."workerSwipe" = 'RIGHT' or a."matchedAt" is not null))
     or (j."employerId" = (select id from me) and (a."matchedAt" is not null or a."employerSwipe" = 'RIGHT' or a."workerSwipe" = 'RIGHT'))
  order by coalesce(a."matchedAt", a."createdAt") desc
$$;

grant execute on function public.my_applications() to authenticated;
revoke execute on function public.my_applications() from public, anon;

notify pgrst, 'reload schema';

commit;
