-- Adds isolated flow-test records to the existing Supabase project.
-- Run manually in Supabase Dashboard -> SQL Editor. Re-running replaces only
-- records carrying this script's unique [TEST-SERVEIT-20261027] prefix.
-- WARNING: open test jobs can appear in the worker feed for other eligible users.
-- Does not change account roles, verification, subscription, or availability.

begin;

do $$
declare
  v_worker_id integer;
  v_employer_id integer;
  v_feed_job_id integer;
  v_liked_job_id integer;
  v_match_job_id integer;
  v_offer_job_id integer;
  v_match_application_id integer;
  v_offer_application_id integer;
  v_seeded_at timestamptz := '2099-12-31 23:59:59+00'::timestamptz;
begin
  select id into v_worker_id
  from public."User"
  where lower(email) = lower('shirtoren25@gmail.com') and role = 'WORKER';

  select id into v_employer_id
  from public."User"
  where lower(email) = lower('pillipgal@gmail.com') and role = 'EMPLOYER';

  if v_worker_id is null or v_employer_id is null then
    raise exception 'Test accounts were not found with the expected WORKER and EMPLOYER roles. Check the email addresses and account roles, then rerun.';
  end if;

  if not exists (select 1 from public."WorkerProfile" where "userId" = v_worker_id)
     or not exists (select 1 from public."EmployerProfile" where "userId" = v_employer_id) then
    raise exception 'One of the test accounts is missing its app profile. Complete registration before seeding.';
  end if;

  if not exists (
    select 1 from public."EmployerProfile"
    where "userId" = v_employer_id
      and ("subscriptionStatus" = 'ACTIVE' or ("subscriptionStatus" = 'TRIAL' and "trialEndsAt" > now()))
      and "isVerified"
  ) then
    raise exception 'The employer account must be business-verified and have an active plan/trial. No account data was changed.';
  end if;

  -- Idempotency: remove only this script's prior tagged test jobs and preference.
  delete from public."Job"
  where "employerId" = v_employer_id
    and title like '[TEST-SERVEIT-20261027]%';

  delete from public."WorkerPreference"
  where "workerId" = v_worker_id
    and "createdAt" = v_seeded_at
    and city = 'תל אביב'
    and categories = array['אירועים', 'מסעדנות']::text[];

  -- Preference is clearly marked by a reserved timestamp for exact cleanup.
  insert into public."WorkerPreference" (
    "workerId", "employmentType", "minHourlyPay", "availableDates",
    "transportOnly", "createdAt", city, "radiusKm",
    "minMonthlyPay", categories, workloads
  ) values (
    v_worker_id, 'TEMPORARY', 35,
    array[(current_date + 3), (current_date + 4), (current_date + 5), (current_date + 6)],
    false, v_seeded_at, 'תל אביב', 40, 0, array['אירועים', 'מסעדנות'], '{}'
  );

  -- Four future jobs exercise the feed, candidate swipe, match/chat, and offer flows.
  insert into public."Job" (
    title, category, city, region, lat, lng, "employmentType", "date", shift,
    "payType", "hourlyPay", "monthlyPay", workload, "requiredWorkers",
    description, "transportOffered", "transportFrom", "verifiedEmployer", "employerId"
  )
  select
    '[TEST-SERVEIT-20261027] ' || test.title,
    test.category,
    city.name,
    city.region,
    city.lat,
    city.lng,
    'TEMPORARY',
    timezone('Asia/Jerusalem', (current_date + test.day_offset)::timestamp + test.starts_at),
    test.shift,
    'HOURLY',
    test.hourly_pay,
    null,
    null,
    2,
    test.description,
    test.transport_offered,
    case when test.transport_offered then 'תחנת רכבת תל אביב מרכז' else null end,
    false,
    v_employer_id
  from (values
    ('משרת אירועים - פיד עובד', 'אירועים', 3, time '18:00', 'EVENING'::public."ShiftWindow", 85, 'רשומת בדיקה בלבד. אין להגיע למשמרת.', true),
    ('קייטרינג - מועמד חדש', 'מסעדנות', 4, time '17:00', 'EVENING'::public."ShiftWindow", 90, 'רשומת בדיקה בלבד. אין להגיע למשמרת.', false),
    ('משמרת אירועים - התאמה וצ׳אט', 'אירועים', 5, time '16:00', 'AFTERNOON'::public."ShiftWindow", 95, 'רשומת בדיקה בלבד. אין להגיע למשמרת.', true),
    ('סיוע באירוע - הצעה ממתינה', 'מסעדנות', 6, time '19:00', 'EVENING'::public."ShiftWindow", 100, 'רשומת בדיקה בלבד. אין להגיע למשמרת.', false)
  ) as test(title, category, day_offset, starts_at, shift, hourly_pay, description, transport_offered)
  join public."City" city on city.name = 'תל אביב'
  join public."JobCategory" category on category.name = test.category and category."isActive";

  select id into v_feed_job_id from public."Job"
  where "employerId" = v_employer_id and title = '[TEST-SERVEIT-20261027] משרת אירועים - פיד עובד';
  select id into v_liked_job_id from public."Job"
  where "employerId" = v_employer_id and title = '[TEST-SERVEIT-20261027] קייטרינג - מועמד חדש';
  select id into v_match_job_id from public."Job"
  where "employerId" = v_employer_id and title = '[TEST-SERVEIT-20261027] משמרת אירועים - התאמה וצ׳אט';
  select id into v_offer_job_id from public."Job"
  where "employerId" = v_employer_id and title = '[TEST-SERVEIT-20261027] סיוע באירוע - הצעה ממתינה';

  insert into public."Application" ("jobId", "workerId", stage, "workerSwipe")
  values (v_liked_job_id, v_worker_id, 'LIKED', 'RIGHT');

  insert into public."Application" ("jobId", "workerId", stage, "workerSwipe", "employerSwipe", "matchedAt")
  values (v_match_job_id, v_worker_id, 'MATCHED', 'RIGHT', 'RIGHT', now())
  returning id into v_match_application_id;

  insert into public."ChatMessage" ("applicationId", "senderId", body)
  values
    (v_match_application_id, null, 'שיחת בדיקה: נוצרה התאמה. אפשר לבדוק שליחת הודעות.'),
    (v_match_application_id, v_employer_id, 'היי! זו הודעת בדיקה ממעסיקת הבדיקה.');

  insert into public."Application" ("jobId", "workerId", stage, "workerSwipe", "employerSwipe", "matchedAt")
  values (v_offer_job_id, v_worker_id, 'OFFERED', 'RIGHT', 'RIGHT', now())
  returning id into v_offer_application_id;

  insert into public."JobOffer" (
    "applicationId", "startsAt", "endsAt", address, "payType", "payAmount",
    conditions, status, "expiresAt"
  )
  select v_offer_application_id, j."date", j."date" + interval '4 hours', 'תל אביב (כתובת בדיקה)',
         'HOURLY', j."hourlyPay", 'הצעת בדיקה — אין צורך להגיע למקום.', 'PENDING', now() + interval '7 days'
  from public."Job" j where j.id = v_offer_job_id;

  insert into public."Notification" ("userId", type, title, body, "jobId")
  values (v_worker_id, 'new_job', 'משרת בדיקה חדשה', 'נוספו משרות המסומנות TEST לצורך בדיקת הפיד.', v_feed_job_id);

  insert into public."Notification" ("userId", type, title, body, "applicationId", "jobId")
  values
    (v_worker_id, 'match', 'התאמת בדיקה נוצרה', 'אפשר לפתוח את השיחה ולבדוק צ׳אט.', v_match_application_id, v_match_job_id),
    (v_worker_id, 'offer', 'הצעת בדיקה ממתינה', 'אפשר לבדוק את מסך ההצעה. אין להגיע למשמרת.', v_offer_application_id, v_offer_job_id);
end;
$$;

commit;

select '[TEST-SERVEIT-20261027] Seed complete: 4 tagged jobs, 1 worker preference, applications for swipe/match/offer.' as result;
