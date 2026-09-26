-- Replaces the temporary "anyone can read, any signed-in user can write"
-- access with real rules: users read only their own data (plus what the
-- feeds/RPCs expose, with contact details masked), and all business changes go
-- through the functions in marketplace_functions.

do $$
declare
  t text;
begin
  foreach t in array array[
    'User', 'EmployerPlan', 'WorkerProfile', 'EmployerProfile', 'Job', 'Application',
    'ApplicationReview', 'DocumentDispatch', 'WorkerPreference'
  ] loop
    execute format('drop policy if exists "public read" on %I', t);
    execute format('drop policy if exists "authenticated write" on %I', t);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'City', 'JobCategory', 'WorkerLicense', 'JobOffer', 'ChatMessage', 'Notification',
    'ReliabilityEvent', 'ContactViolation', 'UserReport', 'UserBlock', 'SponsorshipRequest'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end;
$$;

-- Reference data (readable before sign-in, for the landing page and sign-up form).
grant select on "City", "JobCategory", "EmployerPlan" to anon, authenticated;
create policy "read" on "City" for select to anon, authenticated using (true);
create policy "read" on "JobCategory" for select to anon, authenticated using (true);
create policy "read" on "EmployerPlan" for select to anon, authenticated using (true);
grant insert, update, delete on "JobCategory" to authenticated;
grant usage on sequence "JobCategory_id_seq" to authenticated;
create policy "admin write" on "JobCategory" for all to authenticated using (is_admin()) with check (is_admin());

-- Users: own row; admins see everyone. Changes go through admin RPCs.
grant select on "User" to authenticated;
create policy "own or admin" on "User" for select to authenticated using (id = app_user_id() or is_admin());

-- Worker profile: private to the worker (employers see a masked card via the feeds).
grant select on "WorkerProfile" to authenticated;
grant update ("fullName", "age", "city", "bio", "lat", "lng", "locationLabel", "isAvailable", "availabilitySlots")
  on "WorkerProfile" to authenticated;
create policy "own or admin read" on "WorkerProfile" for select to authenticated using ("userId" = app_user_id() or is_admin());
create policy "own update" on "WorkerProfile" for update to authenticated
  using ("userId" = app_user_id()) with check ("userId" = app_user_id());

-- Employer profile: private (public parts via employer_public_profile / job_feed).
grant select on "EmployerProfile" to authenticated;
grant update ("displayName", "description", "logoPath", "photoPaths", "regions", "form101Url")
  on "EmployerProfile" to authenticated;
create policy "own or admin read" on "EmployerProfile" for select to authenticated using ("userId" = app_user_id() or is_admin());
create policy "own update" on "EmployerProfile" for update to authenticated
  using ("userId" = app_user_id()) with check ("userId" = app_user_id());

grant select, insert, update, delete on "WorkerPreference" to authenticated;
grant usage on sequence "WorkerPreference_id_seq" to authenticated;
create policy "own" on "WorkerPreference" for all to authenticated
  using ("workerId" = app_user_id()) with check ("workerId" = app_user_id());
create policy "admin read" on "WorkerPreference" for select to authenticated using (is_admin());

grant select, delete on "WorkerLicense" to authenticated;
grant insert ("workerId", "name", "expiresAt", "filePath") on "WorkerLicense" to authenticated;
grant usage on sequence "WorkerLicense_id_seq" to authenticated;
create policy "own or admin read" on "WorkerLicense" for select to authenticated using ("workerId" = app_user_id() or is_admin());
create policy "own insert" on "WorkerLicense" for insert to authenticated
  with check ("workerId" = app_user_id() and not "isVerified");
create policy "own delete" on "WorkerLicense" for delete to authenticated using ("workerId" = app_user_id());

-- Jobs are not sensitive; creation and changes go through RPCs.
grant select on "Job" to authenticated;
create policy "read" on "Job" for select to authenticated
  using ("employerId" = app_user_id() or is_admin() or "status" <> 'CLOSED');

grant select on "Application", "JobOffer", "ApplicationReview", "DocumentDispatch" to authenticated;
create policy "participants" on "Application" for select to authenticated using (is_application_participant(id));
create policy "participants" on "JobOffer" for select to authenticated using (is_application_participant("applicationId"));
create policy "participants" on "ApplicationReview" for select to authenticated using (is_application_participant("applicationId"));
create policy "participants" on "DocumentDispatch" for select to authenticated using (
  is_admin() or app_user_id() = any("recipients")
  or exists (select 1 from "Job" j where j.id = "jobId" and j."employerId" = app_user_id())
);

grant select on "ChatMessage" to authenticated;
create policy "participants" on "ChatMessage" for select to authenticated using (is_application_participant("applicationId"));

grant select on "Notification" to authenticated;
create policy "own" on "Notification" for select to authenticated using ("userId" = app_user_id());

grant select on "ReliabilityEvent" to authenticated;
create policy "own or admin" on "ReliabilityEvent" for select to authenticated using ("workerId" = app_user_id() or is_admin());

grant select on "ContactViolation" to authenticated;
create policy "admin" on "ContactViolation" for select to authenticated using (is_admin());

grant select on "UserReport" to authenticated;
create policy "own or admin" on "UserReport" for select to authenticated using ("reporterId" = app_user_id() or is_admin());

grant select, delete on "UserBlock" to authenticated;
create policy "own" on "UserBlock" for select to authenticated using ("blockerId" = app_user_id());
create policy "own delete" on "UserBlock" for delete to authenticated using ("blockerId" = app_user_id());

grant select on "SponsorshipRequest" to authenticated;
create policy "own or admin" on "SponsorshipRequest" for select to authenticated using ("requesterId" = app_user_id() or is_admin());

-- Functions callable from the client. Internal helpers (provisioning, scoring,
-- notifications, waitlist moves) stay private.
grant execute on function
  app_user_id(), app_user_role(), is_admin(), is_application_participant(integer), can_access_chat_folder(text),
  employer_public_profile(integer), request_business_verification(text, text, text, text, text),
  create_job(text, text, text, "EmploymentType", date, "ShiftWindow", "PayType", integer, integer, "Workload", integer, text, boolean, text),
  close_job(integer), job_feed(), candidate_feed(integer),
  swipe_job(integer, "SwipeDirection"), swipe_candidate(integer, integer, "SwipeDirection"), rehire_worker(integer, integer),
  send_job_offer(integer, timestamptz, timestamptz, text, "OfferPayType", integer, text, integer),
  cancel_job_offer(integer), respond_job_offer(integer, boolean), cancel_hire(integer, text),
  complete_shift(integer, text), record_payment(integer, integer),
  submit_review(integer, integer, integer, integer, integer, text),
  send_chat_message(integer, text, text), report_user(integer, text, text, integer, bigint), block_user(integer),
  select_plan(text), request_sponsorship(integer, integer), send_documents(integer, text),
  mark_notifications_read(bigint[]), my_applications(), process_due_events(),
  admin_decide_verification(integer, boolean, text), admin_verify_worker(integer, "VerificationLevel"),
  admin_verify_license(integer, boolean), admin_set_suspension(integer, boolean, text, integer),
  admin_resolve_report(integer, "ReportStatus", boolean), admin_delete_message(bigint),
  admin_decide_sponsorship(integer, boolean), admin_set_subscription(integer, "SubscriptionStatus", integer),
  admin_stats(), distance_km(double precision, double precision, double precision, double precision)
to authenticated;

-- Supabase-only pieces. Skipped gracefully where unavailable (e.g. local tests).

-- Realtime for chat and notifications (RLS still applies).
do $$
begin
  alter publication supabase_realtime add table "ChatMessage", "Notification";
exception when others then
  raise notice 'realtime publication not configured: %', sqlerrm;
end;
$$;

-- Storage: chat voice messages (private, conversation participants only),
-- company media (public: logo + workplace photos), worker licenses (private).
do $$
begin
  insert into storage.buckets (id, name, public) values
    ('chat-audio', 'chat-audio', false),
    ('company-media', 'company-media', true),
    ('worker-licenses', 'worker-licenses', false)
  on conflict (id) do nothing;

  create policy "chat audio read" on storage.objects for select to authenticated
    using (bucket_id = 'chat-audio' and public.can_access_chat_folder(name));
  create policy "chat audio upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'chat-audio' and public.can_access_chat_folder(name));

  create policy "company media upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'company-media' and split_part(name, '/', 1) = public.app_user_id()::text);
  create policy "company media delete" on storage.objects for delete to authenticated
    using (bucket_id = 'company-media' and split_part(name, '/', 1) = public.app_user_id()::text);

  create policy "license read" on storage.objects for select to authenticated
    using (bucket_id = 'worker-licenses' and (split_part(name, '/', 1) = public.app_user_id()::text or public.is_admin()));
  create policy "license upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'worker-licenses' and split_part(name, '/', 1) = public.app_user_id()::text);
  create policy "license delete" on storage.objects for delete to authenticated
    using (bucket_id = 'worker-licenses' and split_part(name, '/', 1) = public.app_user_id()::text);
exception when undefined_table or invalid_schema_name then
  raise notice 'storage schema not available: %', sqlerrm;
end;
$$;

-- Offer expiry, waitlist hand-off, reminders, suspension and trial expiry every minute.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('workaway-process-due-events', '* * * * *', 'select public.process_due_events()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
