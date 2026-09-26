export type ShiftWindow = 'morning' | 'afternoon' | 'evening' | 'night'

export type EmploymentType = 'temporary' | 'permanent'

export type Region =
  | 'north'
  | 'haifa'
  | 'sharon'
  | 'center'
  | 'tel_aviv'
  | 'jerusalem'
  | 'shfela'
  | 'south'

export type PayType = 'hourly' | 'monthly'

export type OfferPayType = 'hourly' | 'global'

export type Workload = 'full' | 'part'

export type JobStatus = 'open' | 'filled' | 'closed'

export type SwipeDirection = 'right' | 'left'

export type ApplicationStage =
  | 'liked'
  | 'shortlisted'
  | 'matched'
  | 'offered'
  | 'hired'
  | 'waitlisted'
  | 'completed'
  | 'no_show'
  | 'canceled'
  | 'declined'

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'canceled'

export type SubscriptionStatus = 'trial' | 'active' | 'pending_payment' | 'expired'

export type UserRole = 'worker' | 'employer' | 'admin'

export type City = {
  name: string
  lat: number
  lng: number
  region: Region
}

export type JobCategory = {
  id: number
  name: string
  requiredLicense: string | null
  isActive: boolean
}

// A job card in the worker's feed.
export type Job = {
  id: number
  title: string
  category: string
  city: string
  region: Region | null
  lat: number | null
  lng: number | null
  employmentType: EmploymentType
  // For permanent jobs this is the start date.
  date: string
  shift: ShiftWindow
  payType: PayType
  hourlyPay: number | null
  monthlyPay: number | null
  workload: Workload | null
  description: string
  transportOffered: boolean
  transportFrom?: string
  requiredWorkers: number
  hiredCount: number
  status: JobStatus
  isSponsored: boolean
  employerId: number
  employerName: string
  employerLogoUrl: string | null
  employerDescription: string
  verifiedEmployer: boolean
  employerRatingAvg: number | null
  employerRatingCount: number
  employerLowRating: boolean
  requiredLicense: string | null
}

// A job as its employer manages it.
export type ManagedJob = {
  id: number
  title: string
  category: string
  city: string
  employmentType: EmploymentType
  date: string
  shift: ShiftWindow
  payType: PayType
  hourlyPay: number | null
  monthlyPay: number | null
  workload: Workload | null
  requiredWorkers: number
  status: JobStatus
  description: string
  sponsoredUntil: string | null
  createdAt: string
}

// One saved search preference. A worker can have several; a job fits the worker
// if it matches any of them. Empty arrays mean "no restriction".
export type WorkerPreference = {
  id: number
  employmentType: EmploymentType
  city: string | null
  radiusKm: number
  minHourlyPay: number
  minMonthlyPay: number
  categories: string[]
  // Only used when employmentType is 'permanent'.
  workloads: Workload[]
  // Only used when employmentType is 'temporary'.
  availableDates: string[]
  transportOnly: boolean
}

export type WorkerPreferenceInput = Omit<WorkerPreference, 'id'>

export type WorkerProfile = {
  id: number
  fullName: string
  age: number
  city: string
  bio: string
  lat: number | null
  lng: number | null
  locationLabel: string | null
  isAvailable: boolean
  // Weekly availability heatmap cells, '<day 0-6>:<shift>' e.g. '0:morning'.
  availabilitySlots: string[]
  reliabilityScore: number
  completedStreak: number
  rating: number
  ratingCount: number
  verificationLevel: 'basic' | 'verified'
  tags: string[]
  sponsoredUntil: string | null
  preferences: WorkerPreference[]
}

export type WorkerProfileUpdate = Pick<WorkerProfile, 'fullName' | 'age' | 'city' | 'bio'> &
  Partial<Pick<WorkerProfile, 'lat' | 'lng' | 'locationLabel'>>

export type WorkerLicense = {
  id: number
  name: string
  expiresAt: string | null
  filePath: string | null
  isVerified: boolean
}

export type ReliabilityEvent = {
  id: number
  type:
    | 'no_show'
    | 'cancel_under_4h'
    | 'cancel_4_to_24h'
    | 'cancel_over_24h'
    | 'late_arrival'
    | 'shift_completed'
    | 'streak_bonus'
  delta: number
  createdAt: string
}

export type EmployerProfile = {
  id: number
  displayName: string
  description: string
  logoPath: string | null
  logoUrl: string | null
  photoPaths: string[]
  photoUrls: string[]
  regions: Region[]
  form101Url: string | null
  isVerified: boolean
  businessId: string | null
  legalName: string | null
  businessAddress: string | null
  representativeName: string | null
  representativePhone: string | null
  verificationRequestedAt: string | null
  verificationNote: string | null
  trialEndsAt: string
  subscriptionStatus: SubscriptionStatus
  activePlanId: number | null
  ratingAvg: number | null
  ratingCount: number
  ratingWarningAt: string | null
}

// What workers can see about a company (no business registration or contact details).
export type PublicEmployerProfile = {
  id: number
  displayName: string
  description: string
  logoUrl: string | null
  photoUrls: string[]
  regions: Region[]
  isVerified: boolean
  ratingAvg: number | null
  ratingCount: number
  openJobs: number
}

export type EmployerProfileUpdate = Pick<
  EmployerProfile,
  'displayName' | 'description' | 'regions' | 'form101Url' | 'logoPath' | 'photoPaths'
>

export type BusinessVerificationInput = {
  businessId: string
  legalName: string
  businessAddress: string
  representativeName: string
  representativePhone: string
}

export type EmployerPlan = {
  id: 'starter' | 'pro' | 'scale'
  dbId: number
  name: string
  monthlyPrice: number
  openingsLimit: number
  features: string[]
}

export type JobOffer = {
  id: number
  status: OfferStatus
  startsAt: string
  endsAt: string
  address: string
  payType: OfferPayType
  payAmount: number
  conditions: string
  expiresAt: string
  fromWaitlist: boolean
}

export type JobOfferInput = {
  applicationId: number
  startsAt: string
  endsAt: string
  address: string
  payType: OfferPayType
  payAmount: number
  conditions: string
  responseMinutes: number
}

// A worker x job relationship, as seen by either side.
export type Application = {
  id: number
  jobId: number
  workerId: number
  employerId: number
  stage: ApplicationStage
  workerSwipe: SwipeDirection | null
  employerSwipe: SwipeDirection | null
  matchedAt: string | null
  canceledAt: string | null
  canceledBy: 'worker' | 'employer' | 'admin' | null
  cancellationReason: string | null
  arrivedLate: boolean
  completedAt: string | null
  paidAmount: number | null
  declineReason: string | null
  createdAt: string
  job: {
    title: string
    category: string
    city: string
    date: string
    shift: ShiftWindow
    employmentType: EmploymentType
    payType: PayType
    hourlyPay: number | null
    monthlyPay: number | null
    status: JobStatus
    requiredWorkers: number
    hiredCount: number
  }
  employer: {
    name: string
    logoUrl: string | null
    ratingAvg: number | null
  }
  worker: {
    firstName: string
    reliabilityScore: number
    rating: number
    city: string | null
  }
  offer: JobOffer | null
  waitlistPosition: number | null
  lastMessageAt: string | null
  reviewedByMe: boolean
}

export type Candidate = {
  workerId: number
  firstName: string
  age: number
  city: string | null
  bio: string
  reliabilityScore: number
  rating: number
  ratingCount: number
  distanceKm: number | null
  categories: string[]
  licenses: string[]
  hasRequiredLicense: boolean
  likedJob: boolean
  isFlexible: boolean
  completedShifts: number
  isSponsored: boolean
}

export type ChatMessage = {
  id: number
  applicationId: number
  // null = system message
  senderId: number | null
  body: string | null
  audioPath: string | null
  wasFiltered: boolean
  createdAt: string
}

export type AppNotification = {
  id: number
  type: string
  title: string
  body: string
  applicationId: number | null
  jobId: number | null
  readAt: string | null
  createdAt: string
}

export type AuthResponse = {
  role: UserRole
  userId: number
  requiresEmailConfirmation?: boolean
}

export type AuthUser = {
  id: number
  email: string
  role: UserRole
  fullName: string | null
  displayName: string | null
  isSuspended?: boolean
  suspendedUntil?: string | null
  suspensionReason?: string | null
}

export type AdminOverview = {
  usersCount: number
  workersCount: number
  employersCount: number
  suspendedUsers: number
  jobsCount: number
  openJobs: number
  filledJobs: number
  matchesCount: number
  hiresCount: number
  completedShifts: number
  noShows: number
  noShowRate: number
  pendingWorkers: number
  pendingEmployers: number
  openReports: number
  violationsLastWeek: number
  activeTrials: number
  pendingPayments: number
  pendingSponsorships: number
}

export type AdminUserRow = {
  id: number
  email: string
  role: UserRole
  isSuspended: boolean
  suspendedUntil: string | null
  suspensionReason: string | null
  contactViolations: number
  createdAt: string
  worker: {
    fullName: string
    city: string
    rating: number
    reliabilityScore: number
    verificationLevel: 'basic' | 'verified'
  } | null
  employer: {
    displayName: string
    isVerified: boolean
    businessId: string | null
    legalName: string | null
    businessAddress: string | null
    representativeName: string | null
    representativePhone: string | null
    verificationRequestedAt: string | null
    verificationNote: string | null
    subscriptionStatus: SubscriptionStatus
    trialEndsAt: string
    activePlanId: number | null
    ratingAvg: number | null
    ratingCount: number
  } | null
}

export type ContactViolationRow = {
  id: number
  userId: number
  email: string
  source: string
  originalText: string
  createdAt: string
}

export type UserReportRow = {
  id: number
  reporterEmail: string
  reportedId: number
  reportedEmail: string
  applicationId: number | null
  messageId: number | null
  reason: string
  details: string
  status: 'open' | 'resolved' | 'dismissed'
  createdAt: string
}

export type SponsorshipRequestRow = {
  id: number
  requesterEmail: string
  jobId: number | null
  jobTitle: string | null
  days: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export type PendingLicenseRow = {
  id: number
  workerEmail: string
  name: string
  expiresAt: string | null
  filePath: string | null
}
