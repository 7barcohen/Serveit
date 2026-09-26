-- WorkAway marketplace data model: mutual matching, offers, chat, shift caps and
-- waitlists, reliability score, employer ratings, trust & safety, monetization.

-- Enums ---------------------------------------------------------------------

create type "ApplicationStage" as enum (
  'LIKED',        -- worker swiped right, employer has not yet
  'SHORTLISTED',  -- employer swiped right, worker has not yet
  'MATCHED',      -- both swiped right; chat is open
  'OFFERED',      -- a formal job offer is waiting for the worker
  'HIRED',        -- worker accepted an offer; counts toward the shift cap
  'WAITLISTED',   -- matched, but the job is full
  'COMPLETED',    -- employer confirmed the shift was worked
  'NO_SHOW',
  'CANCELED',     -- a hire was canceled by the worker or employer
  'DECLINED'      -- a left swipe, or dropped out of the process
);
create type "SwipeDirection" as enum ('RIGHT', 'LEFT');
create type "PayType" as enum ('HOURLY', 'MONTHLY');
create type "OfferPayType" as enum ('HOURLY', 'GLOBAL');
create type "OfferStatus" as enum ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELED');
create type "JobStatus" as enum ('OPEN', 'FILLED', 'CLOSED');
create type "Workload" as enum ('FULL', 'PART');
create type "ReliabilityEventType" as enum (
  'NO_SHOW', 'CANCEL_UNDER_4H', 'CANCEL_4_TO_24H', 'CANCEL_OVER_24H',
  'LATE_ARRIVAL', 'SHIFT_COMPLETED', 'STREAK_BONUS'
);
create type "ReportStatus" as enum ('OPEN', 'RESOLVED', 'DISMISSED');
create type "SubscriptionStatus" as enum ('TRIAL', 'ACTIVE', 'PENDING_PAYMENT', 'EXPIRED');
create type "RequestStatus" as enum ('PENDING', 'APPROVED', 'REJECTED');

-- Reference data ------------------------------------------------------------

create table "City" (
  "name"   text primary key,
  "lat"    double precision not null,
  "lng"    double precision not null,
  "region" "Region" not null
);

insert into "City" ("name", "lat", "lng", "region") values
  ('נהריה', 33.0059, 35.0981, 'NORTH'),
  ('עכו', 32.9281, 35.0818, 'NORTH'),
  ('כרמיאל', 32.9190, 35.2950, 'NORTH'),
  ('צפת', 32.9646, 35.4960, 'NORTH'),
  ('טבריה', 32.7959, 35.5310, 'NORTH'),
  ('נצרת', 32.6996, 35.3035, 'NORTH'),
  ('נוף הגליל', 32.7050, 35.3230, 'NORTH'),
  ('עפולה', 32.6078, 35.2897, 'NORTH'),
  ('בית שאן', 32.4970, 35.4960, 'NORTH'),
  ('קריית שמונה', 33.2073, 35.5695, 'NORTH'),
  ('מגדל העמק', 32.6760, 35.2400, 'NORTH'),
  ('יקנעם עילית', 32.6590, 35.1100, 'NORTH'),
  ('שפרעם', 32.8060, 35.1700, 'NORTH'),
  ('חיפה', 32.7940, 34.9896, 'HAIFA'),
  ('קריית אתא', 32.8090, 35.1060, 'HAIFA'),
  ('קריית ביאליק', 32.8330, 35.0850, 'HAIFA'),
  ('קריית מוצקין', 32.8370, 35.0780, 'HAIFA'),
  ('קריית ים', 32.8490, 35.0690, 'HAIFA'),
  ('נשר', 32.7660, 35.0430, 'HAIFA'),
  ('טירת כרמל', 32.7600, 34.9720, 'HAIFA'),
  ('זכרון יעקב', 32.5710, 34.9550, 'HAIFA'),
  ('חדרה', 32.4340, 34.9190, 'HAIFA'),
  ('אום אל-פחם', 32.5190, 35.1530, 'HAIFA'),
  ('נתניה', 32.3215, 34.8532, 'SHARON'),
  ('הרצליה', 32.1663, 34.8436, 'SHARON'),
  ('רעננה', 32.1848, 34.8713, 'SHARON'),
  ('כפר סבא', 32.1750, 34.9070, 'SHARON'),
  ('הוד השרון', 32.1500, 34.8880, 'SHARON'),
  ('רמת השרון', 32.1460, 34.8390, 'SHARON'),
  ('כפר יונה', 32.3170, 34.9350, 'SHARON'),
  ('אבן יהודה', 32.2700, 34.8880, 'SHARON'),
  ('טייבה', 32.2660, 35.0090, 'SHARON'),
  ('פתח תקווה', 32.0871, 34.8875, 'CENTER'),
  ('ראש העין', 32.0960, 34.9570, 'CENTER'),
  ('ראשון לציון', 31.9640, 34.8040, 'CENTER'),
  ('לוד', 31.9510, 34.8950, 'CENTER'),
  ('רמלה', 31.9290, 34.8660, 'CENTER'),
  ('מודיעין', 31.8990, 35.0100, 'CENTER'),
  ('יהוד', 32.0330, 34.8870, 'CENTER'),
  ('שוהם', 31.9990, 34.9460, 'CENTER'),
  ('אלעד', 32.0520, 34.9510, 'CENTER'),
  ('באר יעקב', 31.9430, 34.8340, 'CENTER'),
  ('תל אביב', 32.0853, 34.7818, 'TEL_AVIV'),
  ('רמת גן', 32.0680, 34.8240, 'TEL_AVIV'),
  ('גבעתיים', 32.0720, 34.8110, 'TEL_AVIV'),
  ('בני ברק', 32.0840, 34.8340, 'TEL_AVIV'),
  ('חולון', 32.0110, 34.7740, 'TEL_AVIV'),
  ('בת ים', 31.9680, 34.7500, 'TEL_AVIV'),
  ('אור יהודה', 32.0290, 34.8520, 'TEL_AVIV'),
  ('קריית אונו', 32.0590, 34.8550, 'TEL_AVIV'),
  ('גבעת שמואל', 32.0780, 34.8480, 'TEL_AVIV'),
  ('ירושלים', 31.7683, 35.2137, 'JERUSALEM'),
  ('מבשרת ציון', 31.8020, 35.1500, 'JERUSALEM'),
  ('מעלה אדומים', 31.7770, 35.2980, 'JERUSALEM'),
  ('ביתר עילית', 31.6970, 35.1160, 'JERUSALEM'),
  ('בית שמש', 31.7470, 34.9880, 'JERUSALEM'),
  ('רחובות', 31.8940, 34.8120, 'SHFELA'),
  ('נס ציונה', 31.9300, 34.7990, 'SHFELA'),
  ('יבנה', 31.8780, 34.7390, 'SHFELA'),
  ('גדרה', 31.8140, 34.7780, 'SHFELA'),
  ('מזכרת בתיה', 31.8530, 34.8460, 'SHFELA'),
  ('קריית עקרון', 31.8610, 34.8220, 'SHFELA'),
  ('אשדוד', 31.8040, 34.6550, 'SOUTH'),
  ('אשקלון', 31.6690, 34.5710, 'SOUTH'),
  ('קריית גת', 31.6100, 34.7640, 'SOUTH'),
  ('קריית מלאכי', 31.7300, 34.7450, 'SOUTH'),
  ('שדרות', 31.5250, 34.5960, 'SOUTH'),
  ('נתיבות', 31.4230, 34.5890, 'SOUTH'),
  ('אופקים', 31.3140, 34.6200, 'SOUTH'),
  ('באר שבע', 31.2520, 34.7910, 'SOUTH'),
  ('דימונה', 31.0690, 35.0330, 'SOUTH'),
  ('ערד', 31.2590, 35.2120, 'SOUTH'),
  ('אילת', 29.5580, 34.9520, 'SOUTH');

create table "JobCategory" (
  "id"              serial primary key,
  "name"            text not null unique,
  "requiredLicense" text,
  "isActive"        boolean not null default true
);

insert into "JobCategory" ("name", "requiredLicense") values
  ('מסעדנות', null),
  ('אירועים', null),
  ('אבטחה', 'רישיון שמירה / אבטחה'),
  ('לוגיסטיקה', null),
  ('מלגזה', 'רישיון מלגזה'),
  ('אדמיניסטרציה', null),
  ('קמעונאות', null),
  ('ניקיון', null),
  ('שירות לקוחות', null);

-- Keep existing free-text job categories valid.
insert into "JobCategory" ("name")
select distinct "category" from "Job"
on conflict ("name") do nothing;

-- Great-circle distance in km.
create or replace function distance_km(lat1 double precision, lng1 double precision,
                                       lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
  else 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )) end
$$;

-- Users & profiles ----------------------------------------------------------

alter table "WorkerProfile"
  add column "bio"               text not null default '',
  add column "lat"               double precision,
  add column "lng"               double precision,
  add column "locationLabel"     text,
  add column "isAvailable"       boolean not null default true,
  -- Weekly availability heatmap: '<day 0-6>:<SHIFT>' e.g. '0:MORNING' = Sunday morning.
  add column "availabilitySlots" text[] not null default '{}',
  add column "reliabilityScore"  integer not null default 100,
  add column "completedStreak"   integer not null default 0,
  add column "ratingCount"       integer not null default 0,
  add column "sponsoredUntil"    timestamptz;

update "WorkerProfile" w
set "lat" = c."lat", "lng" = c."lng", "locationLabel" = c."name"
from "City" c
where c."name" = w."city";

alter table "EmployerProfile"
  add column "description"             text not null default '',
  add column "logoPath"                text,
  add column "photoPaths"              text[] not null default '{}',
  add column "regions"                 "Region"[] not null default '{}',
  add column "form101Url"              text,
  -- Business verification (private: employer + admin only).
  add column "businessId"              text,
  add column "legalName"               text,
  add column "businessAddress"         text,
  add column "representativeName"      text,
  add column "representativePhone"     text,
  add column "verificationRequestedAt" timestamptz,
  add column "verificationNote"        text,
  -- Monetization: employers pay; the first two months are free.
  add column "trialEndsAt"             timestamptz not null default (now() + interval '2 months'),
  add column "subscriptionStatus"      "SubscriptionStatus" not null default 'TRIAL',
  add column "ratingAvg"               numeric(3, 2),
  add column "ratingCount"             integer not null default 0,
  add column "ratingWarningAt"         timestamptz,
  add column "createdAt"               timestamptz not null default now();

create table "WorkerLicense" (
  "id"         serial primary key,
  "workerId"   integer not null references "User"("id") on delete cascade,
  "name"       text not null check (length(trim("name")) > 0),
  "expiresAt"  date,
  "filePath"   text,
  "isVerified" boolean not null default false,
  "createdAt"  timestamptz not null default now()
);
create index "WorkerLicense_workerId_idx" on "WorkerLicense" ("workerId");

-- Preferences: each saved preference has its own location + radius, pay
-- expectation, categories (empty = open to all fields) and, for permanent
-- work, full/part time. Weekly availability lives on the profile.
alter table "WorkerPreference"
  drop column "regions",
  drop column "preferredShifts",
  add column "city"         text references "City"("name"),
  add column "radiusKm"     integer not null default 15 check ("radiusKm" between 1 and 300),
  add column "minMonthlyPay" integer not null default 0 check ("minMonthlyPay" >= 0),
  add column "categories"   text[] not null default '{}',
  add column "workloads"    "Workload"[] not null default '{}';

update "WorkerPreference" p
set "city" = w."city"
from "WorkerProfile" w
where w."userId" = p."workerId" and exists (select 1 from "City" c where c."name" = w."city");

-- Jobs ----------------------------------------------------------------------

alter table "Job"
  alter column "hourlyPay" drop not null,
  add column "payType"         "PayType" not null default 'HOURLY',
  add column "monthlyPay"      integer,
  add column "workload"        "Workload",
  add column "requiredWorkers" integer not null default 1 check ("requiredWorkers" between 1 and 500),
  add column "status"          "JobStatus" not null default 'OPEN',
  add column "lat"             double precision,
  add column "lng"             double precision,
  add column "sponsoredUntil"  timestamptz,
  add constraint "Job_pay_check" check (
    ("payType" = 'HOURLY' and "hourlyPay" > 0) or ("payType" = 'MONTHLY' and "monthlyPay" > 0)
  );

update "Job" j
set "lat" = c."lat", "lng" = c."lng", "region" = coalesce(j."region", c."region")
from "City" c
where c."name" = j."city";

-- Applications: one row per worker x job, carrying both swipes and the stage.

alter table "Application"
  add column "stage"         "ApplicationStage",
  add column "workerSwipe"   "SwipeDirection",
  add column "employerSwipe" "SwipeDirection",
  add column "matchedAt"     timestamptz,
  add column "arrivedLate"   boolean not null default false,
  add column "completedAt"   timestamptz,
  add column "paidAmount"    integer check ("paidAmount" >= 0),
  add column "declineReason" text;

-- Old flow: a worker right-swipe created the row; APPROVED meant the employer accepted.
update "Application" set
  "workerSwipe" = 'RIGHT',
  "employerSwipe" = case when "state" = 'APPROVED' then 'RIGHT'::"SwipeDirection" end,
  "matchedAt" = case when "state" = 'APPROVED' then "updatedAt" end,
  "stage" = case
    when "canceledAt" is not null then 'CANCELED'::"ApplicationStage"
    when "state" = 'APPROVED' then 'MATCHED'::"ApplicationStage"
    when "state" = 'PENDING' then 'LIKED'::"ApplicationStage"
    else 'DECLINED'::"ApplicationStage"
  end;

alter table "Application"
  alter column "stage" set not null,
  alter column "stage" set default 'LIKED',
  drop column "state",
  drop column "penaltyPoints";

drop type "ApplicationState";

create index "Application_workerId_idx" on "Application" ("workerId");
create index "Application_stage_idx" on "Application" ("jobId", "stage");

create table "JobOffer" (
  "id"               serial primary key,
  "applicationId"    integer not null references "Application"("id") on delete cascade,
  "startsAt"         timestamptz not null,
  "endsAt"           timestamptz not null,
  "address"          text not null check (length(trim("address")) > 0),
  "payType"          "OfferPayType" not null,
  "payAmount"        integer not null check ("payAmount" > 0),
  "conditions"       text not null default '',
  "status"           "OfferStatus" not null default 'PENDING',
  "expiresAt"        timestamptz not null,
  "fromWaitlist"     boolean not null default false,
  "respondedAt"      timestamptz,
  "reminder24SentAt" timestamptz,
  "reminder2SentAt"  timestamptz,
  "createdAt"        timestamptz not null default now(),
  check ("endsAt" > "startsAt")
);
create index "JobOffer_applicationId_idx" on "JobOffer" ("applicationId");
create index "JobOffer_pending_idx" on "JobOffer" ("expiresAt") where "status" = 'PENDING';

-- Reviews: employers rate workers with "score"; workers rate employers on
-- three parameters ("score" holds their rounded average).
alter table "ApplicationReview"
  add column "paymentScore"     smallint check ("paymentScore" between 1 and 5),
  add column "environmentScore" smallint check ("environmentScore" between 1 and 5),
  add column "clarityScore"     smallint check ("clarityScore" between 1 and 5),
  add constraint "ApplicationReview_score_check" check ("score" between 1 and 5);

-- Chat, notifications, trust & safety ---------------------------------------

create table "ChatMessage" (
  "id"            bigserial primary key,
  "applicationId" integer not null references "Application"("id") on delete cascade,
  -- null = system message
  "senderId"      integer references "User"("id") on delete set null,
  "body"          text,
  "audioPath"     text,
  "wasFiltered"   boolean not null default false,
  "createdAt"     timestamptz not null default now(),
  check ("body" is not null or "audioPath" is not null)
);
create index "ChatMessage_applicationId_idx" on "ChatMessage" ("applicationId", "createdAt");

create table "Notification" (
  "id"            bigserial primary key,
  "userId"        integer not null references "User"("id") on delete cascade,
  "type"          text not null,
  "title"         text not null,
  "body"          text not null default '',
  "applicationId" integer references "Application"("id") on delete cascade,
  "jobId"         integer references "Job"("id") on delete cascade,
  "readAt"        timestamptz,
  "createdAt"     timestamptz not null default now()
);
create index "Notification_userId_idx" on "Notification" ("userId", "createdAt" desc);

create table "ReliabilityEvent" (
  "id"            serial primary key,
  "workerId"      integer not null references "User"("id") on delete cascade,
  "applicationId" integer references "Application"("id") on delete set null,
  "type"          "ReliabilityEventType" not null,
  "delta"         integer not null,
  "createdAt"     timestamptz not null default now()
);
create index "ReliabilityEvent_workerId_idx" on "ReliabilityEvent" ("workerId", "createdAt" desc);

create table "ContactViolation" (
  "id"            serial primary key,
  "userId"        integer not null references "User"("id") on delete cascade,
  "applicationId" integer references "Application"("id") on delete set null,
  "source"        text not null,
  "originalText"  text not null,
  "createdAt"     timestamptz not null default now()
);

create table "UserReport" (
  "id"            serial primary key,
  "reporterId"    integer not null references "User"("id") on delete cascade,
  "reportedId"    integer not null references "User"("id") on delete cascade,
  "applicationId" integer references "Application"("id") on delete set null,
  "messageId"     bigint references "ChatMessage"("id") on delete set null,
  "reason"        text not null check (length(trim("reason")) > 0),
  "details"       text not null default '',
  "status"        "ReportStatus" not null default 'OPEN',
  "resolvedById"  integer references "User"("id") on delete set null,
  "resolvedAt"    timestamptz,
  "createdAt"     timestamptz not null default now(),
  check ("reporterId" <> "reportedId")
);

create table "UserBlock" (
  "blockerId" integer not null references "User"("id") on delete cascade,
  "blockedId" integer not null references "User"("id") on delete cascade,
  "createdAt" timestamptz not null default now(),
  primary key ("blockerId", "blockedId"),
  check ("blockerId" <> "blockedId")
);

create table "SponsorshipRequest" (
  "id"          serial primary key,
  "requesterId" integer not null references "User"("id") on delete cascade,
  -- null = promote the requester's own worker profile
  "jobId"       integer references "Job"("id") on delete cascade,
  "days"        integer not null check ("days" between 1 and 90),
  "status"      "RequestStatus" not null default 'PENDING',
  "decidedAt"   timestamptz,
  "createdAt"   timestamptz not null default now()
);

delete from "DocumentDispatch" d where not exists (select 1 from "Job" j where j.id = d."jobId");
alter table "DocumentDispatch"
  add constraint "DocumentDispatch_jobId_fkey" foreign key ("jobId") references "Job"("id") on delete cascade;
