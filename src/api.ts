import type {
  AdminOverview,
  AdminUserRow,
  AppNotification,
  Application,
  ApplicationStage,
  AuthResponse,
  AuthUser,
  BusinessVerificationInput,
  Candidate,
  ChatMessage,
  City,
  ContactViolationRow,
  EmployerPlan,
  EmployerProfile,
  EmployerProfileUpdate,
  EmploymentType,
  Job,
  JobCategory,
  JobOfferInput,
  ManagedJob,
  PayType,
  PendingLicenseRow,
  PublicEmployerProfile,
  ReliabilityEvent,
  ShiftWindow,
  SponsorshipRequestRow,
  SubscriptionStatus,
  SwipeDirection,
  UserReportRow,
  UserRole,
  Workload,
  WorkerLicense,
  WorkerPreference,
  WorkerPreferenceInput,
  WorkerProfile,
  WorkerProfileUpdate,
} from './types'
import { supabase } from './lib/supabase'

const roleOutMap: Record<'WORKER' | 'EMPLOYER' | 'ADMIN', UserRole> = {
  WORKER: 'worker',
  EMPLOYER: 'employer',
  ADMIN: 'admin',
}

const roleInMap: Record<UserRole, 'WORKER' | 'EMPLOYER' | 'ADMIN'> = {
  worker: 'WORKER',
  employer: 'EMPLOYER',
  admin: 'ADMIN',
}

const shiftOutMap: Record<'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT', ShiftWindow> = {
  MORNING: 'morning',
  AFTERNOON: 'afternoon',
  EVENING: 'evening',
  NIGHT: 'night',
}

const shiftInMap: Record<ShiftWindow, 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT'> = {
  morning: 'MORNING',
  afternoon: 'AFTERNOON',
  evening: 'EVENING',
  night: 'NIGHT',
}

const employmentTypeOutMap: Record<'TEMPORARY' | 'PERMANENT', EmploymentType> = {
  TEMPORARY: 'temporary',
  PERMANENT: 'permanent',
}

const employmentTypeInMap: Record<EmploymentType, 'TEMPORARY' | 'PERMANENT'> = {
  temporary: 'TEMPORARY',
  permanent: 'PERMANENT',
}

// The remaining DB enums are the upper-case form of the client values
// (TEL_AVIV <-> tel_aviv, NO_SHOW <-> no_show).
const fromDb = <T extends string>(value: string) => value.toLowerCase() as T
const toDb = (value: string) => value.toUpperCase()
const fromDbOrNull = <T extends string>(value: string | null) => (value ? fromDb<T>(value) : null)

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const toNumberOrNull = (value: unknown) => (value === null || value === undefined ? null : toNumber(value))

// Timestamps stored at UTC midnight for a calendar day -> 'YYYY-MM-DD'.
const toDay = (value: string) => new Date(value).toISOString().slice(0, 10)

const fail = (error: { message: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback)
}

const rpc = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) fail(error, 'הפעולה נכשלה')
  return data as T
}

const companyMediaUrl = (path: string | null) =>
  path ? supabase.storage.from('company-media').getPublicUrl(path).data.publicUrl : null

const signedUrl = async (bucket: string, path: string) => {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
  if (error || !data) fail(error, 'טעינת הקובץ נכשלה')
  return data!.signedUrl
}

const fileExtension = (file: Blob, fallback: string) => {
  if (file instanceof File && file.name.includes('.')) return file.name.split('.').pop()!.toLowerCase()
  return file.type.split('/')[1]?.split(';')[0] ?? fallback
}

const uploadFile = async (bucket: string, folder: string, file: Blob, fallbackExt: string) => {
  const path = `${folder}/${crypto.randomUUID()}.${fileExtension(file, fallbackExt)}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || undefined })
  if (error) fail(error, 'העלאת הקובץ נכשלה')
  return path
}

type WorkerPreferenceRow = {
  id: number
  employmentType: 'TEMPORARY' | 'PERMANENT'
  city: string | null
  radiusKm: number
  minHourlyPay: number
  minMonthlyPay: number
  categories: string[]
  workloads: string[]
  availableDates: string[]
  transportOnly: boolean
}

const mapWorkerPreference = (row: WorkerPreferenceRow): WorkerPreference => ({
  id: row.id,
  employmentType: employmentTypeOutMap[row.employmentType],
  city: row.city,
  radiusKm: row.radiusKm,
  minHourlyPay: row.minHourlyPay,
  minMonthlyPay: row.minMonthlyPay,
  categories: row.categories,
  workloads: row.workloads.map((value) => fromDb<Workload>(value)),
  availableDates: row.availableDates,
  transportOnly: row.transportOnly,
})

type JobFeedRow = {
  id: number
  title: string
  category: string
  city: string
  region: string | null
  lat: number | null
  lng: number | null
  employmentType: 'TEMPORARY' | 'PERMANENT'
  date: string
  shift: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT'
  payType: string
  hourlyPay: number | null
  monthlyPay: number | null
  workload: string | null
  description: string
  transportOffered: boolean
  transportFrom: string | null
  requiredWorkers: number
  hiredCount: number
  status: string
  isSponsored: boolean
  employerId: number
  employerName: string
  employerLogoPath: string | null
  employerDescription: string
  employerVerified: boolean
  employerRatingAvg: number | null
  employerRatingCount: number
  employerLowRating: boolean | null
  requiredLicense: string | null
}

const mapJob = (row: JobFeedRow): Job => ({
  id: row.id,
  title: row.title,
  category: row.category,
  city: row.city,
  region: fromDbOrNull(row.region),
  lat: row.lat,
  lng: row.lng,
  employmentType: employmentTypeOutMap[row.employmentType],
  date: toDay(row.date),
  shift: shiftOutMap[row.shift],
  payType: fromDb<PayType>(row.payType),
  hourlyPay: row.hourlyPay,
  monthlyPay: row.monthlyPay,
  workload: fromDbOrNull(row.workload),
  description: row.description,
  transportOffered: row.transportOffered,
  transportFrom: row.transportFrom ?? undefined,
  requiredWorkers: row.requiredWorkers,
  hiredCount: row.hiredCount,
  status: fromDb(row.status),
  isSponsored: row.isSponsored,
  employerId: row.employerId,
  employerName: row.employerName,
  employerLogoUrl: companyMediaUrl(row.employerLogoPath),
  employerDescription: row.employerDescription,
  verifiedEmployer: row.employerVerified,
  employerRatingAvg: toNumberOrNull(row.employerRatingAvg),
  employerRatingCount: row.employerRatingCount,
  employerLowRating: row.employerLowRating ?? false,
  requiredLicense: row.requiredLicense,
})

type ManagedJobRow = {
  id: number
  title: string
  category: string
  city: string
  employmentType: 'TEMPORARY' | 'PERMANENT'
  date: string
  shift: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT'
  payType: string
  hourlyPay: number | null
  monthlyPay: number | null
  workload: string | null
  requiredWorkers: number
  status: string
  description: string
  sponsoredUntil: string | null
  createdAt: string
}

const mapManagedJob = (row: ManagedJobRow): ManagedJob => ({
  id: row.id,
  title: row.title,
  category: row.category,
  city: row.city,
  employmentType: employmentTypeOutMap[row.employmentType],
  date: toDay(row.date),
  shift: shiftOutMap[row.shift],
  payType: fromDb<PayType>(row.payType),
  hourlyPay: row.hourlyPay,
  monthlyPay: row.monthlyPay,
  workload: fromDbOrNull(row.workload),
  requiredWorkers: row.requiredWorkers,
  status: fromDb(row.status),
  description: row.description,
  sponsoredUntil: row.sponsoredUntil,
  createdAt: row.createdAt,
})

type ApplicationRow = {
  id: number
  jobId: number
  workerId: number
  employerId: number
  stage: string
  workerSwipe: string | null
  employerSwipe: string | null
  matchedAt: string | null
  canceledAt: string | null
  canceledBy: string | null
  cancellationReason: string | null
  arrivedLate: boolean
  completedAt: string | null
  paidAmount: number | null
  declineReason: string | null
  createdAt: string
  jobTitle: string
  jobCategory: string
  jobCity: string
  jobDate: string
  jobShift: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT'
  jobEmploymentType: 'TEMPORARY' | 'PERMANENT'
  jobPayType: string
  jobHourlyPay: number | null
  jobMonthlyPay: number | null
  jobStatus: string
  jobRequiredWorkers: number
  jobHiredCount: number
  employerName: string
  employerLogoPath: string | null
  employerRatingAvg: number | null
  workerFirstName: string
  workerReliabilityScore: number
  workerRating: number | null
  workerCity: string | null
  offerId: number | null
  offerStatus: string | null
  offerStartsAt: string | null
  offerEndsAt: string | null
  offerAddress: string | null
  offerPayType: string | null
  offerPayAmount: number | null
  offerConditions: string | null
  offerExpiresAt: string | null
  offerFromWaitlist: boolean | null
  waitlistPosition: number | null
  lastMessageAt: string | null
  reviewedByMe: boolean
}

const mapApplication = (row: ApplicationRow): Application => ({
  id: row.id,
  jobId: row.jobId,
  workerId: row.workerId,
  employerId: row.employerId,
  stage: fromDb(row.stage),
  workerSwipe: fromDbOrNull(row.workerSwipe),
  employerSwipe: fromDbOrNull(row.employerSwipe),
  matchedAt: row.matchedAt,
  canceledAt: row.canceledAt,
  canceledBy: fromDbOrNull(row.canceledBy),
  cancellationReason: row.cancellationReason,
  arrivedLate: row.arrivedLate,
  completedAt: row.completedAt,
  paidAmount: row.paidAmount,
  declineReason: row.declineReason,
  createdAt: row.createdAt,
  job: {
    title: row.jobTitle,
    category: row.jobCategory,
    city: row.jobCity,
    date: toDay(row.jobDate),
    shift: shiftOutMap[row.jobShift],
    employmentType: employmentTypeOutMap[row.jobEmploymentType],
    payType: fromDb(row.jobPayType),
    hourlyPay: row.jobHourlyPay,
    monthlyPay: row.jobMonthlyPay,
    status: fromDb(row.jobStatus),
    requiredWorkers: row.jobRequiredWorkers,
    hiredCount: row.jobHiredCount,
  },
  employer: {
    name: row.employerName,
    logoUrl: companyMediaUrl(row.employerLogoPath),
    ratingAvg: toNumberOrNull(row.employerRatingAvg),
  },
  worker: {
    firstName: row.workerFirstName,
    reliabilityScore: row.workerReliabilityScore,
    rating: toNumber(row.workerRating, 0),
    city: row.workerCity,
  },
  offer: row.offerId
    ? {
        id: row.offerId,
        status: fromDb(row.offerStatus!),
        startsAt: row.offerStartsAt!,
        endsAt: row.offerEndsAt!,
        address: row.offerAddress!,
        payType: fromDb(row.offerPayType!),
        payAmount: row.offerPayAmount!,
        conditions: row.offerConditions ?? '',
        expiresAt: row.offerExpiresAt!,
        fromWaitlist: row.offerFromWaitlist ?? false,
      }
    : null,
  waitlistPosition: row.waitlistPosition,
  lastMessageAt: row.lastMessageAt,
  reviewedByMe: row.reviewedByMe,
})

type ChatMessageRow = {
  id: number
  applicationId: number
  senderId: number | null
  body: string | null
  audioPath: string | null
  wasFiltered: boolean
  createdAt: string
}

const mapChatMessage = (row: ChatMessageRow): ChatMessage => ({
  id: row.id,
  applicationId: row.applicationId,
  senderId: row.senderId,
  body: row.body,
  audioPath: row.audioPath,
  wasFiltered: row.wasFiltered,
  createdAt: row.createdAt,
})

type NotificationRow = {
  id: number
  type: string
  title: string
  body: string
  applicationId: number | null
  jobId: number | null
  readAt: string | null
  createdAt: string
}

const mapNotification = (row: NotificationRow): AppNotification => ({ ...row })

type EmployerProfileRow = {
  userId: number
  displayName: string
  description: string
  logoPath: string | null
  photoPaths: string[]
  regions: string[]
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
  subscriptionStatus: string
  activePlanId: number | null
  ratingAvg: number | null
  ratingCount: number
  ratingWarningAt: string | null
}

const mapEmployerProfile = (row: EmployerProfileRow): EmployerProfile => ({
  id: row.userId,
  displayName: row.displayName,
  description: row.description,
  logoPath: row.logoPath,
  logoUrl: companyMediaUrl(row.logoPath),
  photoPaths: row.photoPaths,
  photoUrls: row.photoPaths.map((path) => companyMediaUrl(path)!),
  regions: row.regions.map((region) => fromDb(region)),
  form101Url: row.form101Url,
  isVerified: row.isVerified,
  businessId: row.businessId,
  legalName: row.legalName,
  businessAddress: row.businessAddress,
  representativeName: row.representativeName,
  representativePhone: row.representativePhone,
  verificationRequestedAt: row.verificationRequestedAt,
  verificationNote: row.verificationNote,
  trialEndsAt: row.trialEndsAt,
  subscriptionStatus: fromDb<SubscriptionStatus>(row.subscriptionStatus),
  activePlanId: row.activePlanId,
  ratingAvg: toNumberOrNull(row.ratingAvg),
  ratingCount: row.ratingCount,
  ratingWarningAt: row.ratingWarningAt,
})

const getSessionUser = async () => {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    throw error
  }
  const authUser = data.session?.user
  if (!authUser) {
    throw new Error('No active Supabase session')
  }
  return authUser
}

// The signed-in user's app id (the DB creates the app user on sign-up).
const getAppUserId = async () => {
  const authUser = await getSessionUser()
  const { data, error } = await supabase.from('User').select('id').eq('authId', authUser.id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('החשבון עדיין לא הוגדר במערכת. נסו להתחבר מחדש.')
  return data.id as number
}

export const api = {
  getSession: async () => {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      throw error
    }
    return data.session
  },

  onAuthStateChange: (handler: (user: AuthUser | null) => void) => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        handler(null)
        return
      }
      // Supabase warns against awaiting other auth calls inside this callback.
      window.setTimeout(() => {
        api.getCurrentUser().then(handler, () => handler(null))
      }, 0)
    })

    return () => data.subscription.unsubscribe()
  },

  getCurrentUser: async (): Promise<AuthUser> => {
    const authUser = await getSessionUser()
    const { data: appUser, error } = await supabase.from('User').select('*').eq('authId', authUser.id).maybeSingle()
    if (error) throw error
    if (!appUser) {
      throw new Error('החשבון עדיין לא הוגדר במערכת. נסו להתחבר מחדש.')
    }

    let fullName: string | null = null
    let displayName: string | null = null

    if (appUser.role === 'WORKER') {
      const { data } = await supabase.from('WorkerProfile').select('fullName').eq('userId', appUser.id).maybeSingle()
      fullName = data?.fullName ?? null
    }

    if (appUser.role === 'EMPLOYER') {
      const { data } = await supabase.from('EmployerProfile').select('displayName').eq('userId', appUser.id).maybeSingle()
      displayName = data?.displayName ?? null
    }

    return {
      id: appUser.id,
      email: appUser.email,
      role: roleOutMap[appUser.role as 'WORKER' | 'EMPLOYER' | 'ADMIN'],
      fullName,
      displayName,
      isSuspended: appUser.isSuspended,
      suspendedUntil: appUser.suspendedUntil,
      suspensionReason: appUser.suspensionReason,
    }
  },

  register: async (payload: {
    email: string
    password: string
    role: Exclude<UserRole, 'admin'>
    fullName?: string
    city?: string
    age?: number
    displayName?: string
  }): Promise<AuthResponse> => {
    const { data, error } = await supabase.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: {
          role: payload.role,
          fullName: payload.fullName,
          city: payload.city,
          age: payload.age,
          displayName: payload.displayName,
        },
      },
    })

    if (error) throw error

    return {
      role: payload.role,
      userId: 0,
      requiresEmailConfirmation: !data.session,
    }
  },

  login: async (payload: { email: string; password: string }): Promise<AuthResponse> => {
    const { data, error } = await supabase.auth.signInWithPassword(payload)
    if (error || !data.user) {
      throw error ?? new Error('Login failed')
    }
    const user = await api.getCurrentUser()
    return { role: user.role, userId: user.id }
  },

  logout: async (): Promise<void> => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  // Offer expiry, waitlist hand-off, reminders and suspensions also run on a
  // server schedule; calling this keeps them prompt while the app is open.
  processDueEvents: () => rpc<void>('process_due_events'),

  // Reference data ------------------------------------------------------------

  getCities: async (): Promise<City[]> => {
    const { data, error } = await supabase.from('City').select('*').order('name')
    if (error) throw error
    return (data ?? []).map((row) => ({ ...row, region: fromDb(row.region) }))
  },

  getCategories: async (): Promise<JobCategory[]> => {
    const { data, error } = await supabase.from('JobCategory').select('*').order('name')
    if (error) throw error
    return data ?? []
  },

  getPlans: async (): Promise<EmployerPlan[]> => {
    const { data, error } = await supabase.from('EmployerPlan').select('*').order('monthlyPrice', { ascending: true })
    if (error) throw error
    return (data ?? []).map((plan) => ({
      id: plan.code as EmployerPlan['id'],
      dbId: plan.id,
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      openingsLimit: plan.openingsLimit,
      features: plan.features ?? [],
    }))
  },

  // Worker ----------------------------------------------------------------------

  getWorkerProfile: async (userId: number): Promise<WorkerProfile> => {
    const [profileResult, preferencesResult] = await Promise.all([
      supabase.from('WorkerProfile').select('*').eq('userId', userId).single(),
      supabase.from('WorkerPreference').select('*').eq('workerId', userId).order('createdAt', { ascending: true }),
    ])
    if (profileResult.error) throw profileResult.error
    if (preferencesResult.error) throw preferencesResult.error
    const row = profileResult.data
    return {
      id: row.userId,
      fullName: row.fullName,
      age: row.age,
      city: row.city,
      bio: row.bio,
      lat: row.lat,
      lng: row.lng,
      locationLabel: row.locationLabel,
      isAvailable: row.isAvailable,
      availabilitySlots: (row.availabilitySlots as string[]).map((slot) => slot.toLowerCase()),
      reliabilityScore: row.reliabilityScore,
      completedStreak: row.completedStreak,
      rating: toNumber(row.rating, 0),
      ratingCount: row.ratingCount,
      verificationLevel: row.verificationLevel === 'VERIFIED' ? 'verified' : 'basic',
      tags: row.tags ?? [],
      sponsoredUntil: row.sponsoredUntil,
      preferences: (preferencesResult.data ?? []).map(mapWorkerPreference),
    }
  },

  updateWorkerProfile: async (userId: number, update: WorkerProfileUpdate): Promise<void> => {
    const { error } = await supabase.from('WorkerProfile').update(update).eq('userId', userId)
    if (error) throw error
  },

  setAvailability: async (userId: number, isAvailable: boolean): Promise<void> => {
    const { error } = await supabase.from('WorkerProfile').update({ isAvailable }).eq('userId', userId)
    if (error) throw error
  },

  setAvailabilitySlots: async (userId: number, slots: string[]): Promise<void> => {
    const { error } = await supabase
      .from('WorkerProfile')
      .update({ availabilitySlots: slots.map((slot) => slot.toUpperCase()) })
      .eq('userId', userId)
    if (error) throw error
  },

  addWorkerPreference: async (preference: WorkerPreferenceInput): Promise<WorkerPreference> => {
    const workerId = await getAppUserId()
    const { data: created, error } = await supabase
      .from('WorkerPreference')
      .insert({
        workerId,
        employmentType: employmentTypeInMap[preference.employmentType],
        city: preference.city,
        radiusKm: preference.radiusKm,
        minHourlyPay: preference.minHourlyPay,
        minMonthlyPay: preference.employmentType === 'permanent' ? preference.minMonthlyPay : 0,
        categories: preference.categories,
        workloads: preference.employmentType === 'permanent' ? preference.workloads.map(toDb) : [],
        availableDates: preference.employmentType === 'temporary' ? preference.availableDates : [],
        transportOnly: preference.transportOnly,
      })
      .select('*')
      .single()

    if (error || !created) throw error ?? new Error('Create preference failed')
    return mapWorkerPreference(created)
  },

  deleteWorkerPreference: async (id: number): Promise<void> => {
    const { error } = await supabase.from('WorkerPreference').delete().eq('id', id)
    if (error) throw error
  },

  getJobFeed: async (): Promise<Job[]> => (await rpc<JobFeedRow[]>('job_feed')).map(mapJob),

  swipeJob: (jobId: number, direction: SwipeDirection) =>
    rpc<string>('swipe_job', { p_job_id: jobId, p_direction: toDb(direction) }).then((stage) => fromDb<ApplicationStage>(stage)),

  getReliabilityEvents: async (userId: number): Promise<ReliabilityEvent[]> => {
    const { data, error } = await supabase
      .from('ReliabilityEvent')
      .select('*')
      .eq('workerId', userId)
      .order('createdAt', { ascending: false })
      .limit(30)
    if (error) throw error
    return (data ?? []).map((row) => ({ id: row.id, type: fromDb(row.type), delta: row.delta, createdAt: row.createdAt }))
  },

  getLicenses: async (userId: number): Promise<WorkerLicense[]> => {
    const { data, error } = await supabase.from('WorkerLicense').select('*').eq('workerId', userId).order('createdAt')
    if (error) throw error
    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      expiresAt: row.expiresAt,
      filePath: row.filePath,
      isVerified: row.isVerified,
    }))
  },

  addLicense: async (userId: number, license: { name: string; expiresAt: string | null; file: File | null }) => {
    const filePath = license.file ? await uploadFile('worker-licenses', String(userId), license.file, 'pdf') : null
    const { error } = await supabase
      .from('WorkerLicense')
      .insert({ workerId: userId, name: license.name, expiresAt: license.expiresAt, filePath })
    if (error) throw error
  },

  deleteLicense: async (license: WorkerLicense): Promise<void> => {
    const { error } = await supabase.from('WorkerLicense').delete().eq('id', license.id)
    if (error) throw error
    if (license.filePath) {
      await supabase.storage.from('worker-licenses').remove([license.filePath])
    }
  },

  getLicenseFileUrl: (path: string) => signedUrl('worker-licenses', path),

  // Employer --------------------------------------------------------------------

  getEmployerProfile: async (userId: number): Promise<EmployerProfile> => {
    const { data, error } = await supabase.from('EmployerProfile').select('*').eq('userId', userId).single()
    if (error) throw error
    return mapEmployerProfile(data)
  },

  updateEmployerProfile: async (userId: number, update: EmployerProfileUpdate): Promise<void> => {
    const { error } = await supabase
      .from('EmployerProfile')
      .update({ ...update, regions: update.regions.map(toDb), form101Url: update.form101Url || null })
      .eq('userId', userId)
    if (error) throw error
  },

  uploadCompanyMedia: (userId: number, file: File) => uploadFile('company-media', String(userId), file, 'jpg'),

  requestBusinessVerification: (input: BusinessVerificationInput) =>
    rpc<void>('request_business_verification', {
      p_business_id: input.businessId,
      p_legal_name: input.legalName,
      p_address: input.businessAddress,
      p_representative_name: input.representativeName,
      p_representative_phone: input.representativePhone,
    }),

  selectPlan: (code: EmployerPlan['id']) =>
    rpc<string>('select_plan', { p_plan_code: code }).then((status) => fromDb<SubscriptionStatus>(status)),

  getEmployerPublicProfile: async (employerId: number): Promise<PublicEmployerProfile | null> => {
    const rows = await rpc<Array<Pick<EmployerProfileRow, 'userId' | 'displayName' | 'description' | 'logoPath' | 'photoPaths' | 'regions' | 'isVerified' | 'ratingAvg' | 'ratingCount'> & { openJobs: number }>>(
      'employer_public_profile',
      { p_employer_id: employerId },
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: row.userId,
      displayName: row.displayName,
      description: row.description,
      logoUrl: companyMediaUrl(row.logoPath),
      photoUrls: row.photoPaths.map((path) => companyMediaUrl(path)!),
      regions: row.regions.map((region) => fromDb(region)),
      isVerified: row.isVerified,
      ratingAvg: toNumberOrNull(row.ratingAvg),
      ratingCount: row.ratingCount,
      openJobs: row.openJobs,
    }
  },

  getMyJobs: async (employerId: number): Promise<ManagedJob[]> => {
    const { data, error } = await supabase
      .from('Job')
      .select('*')
      .eq('employerId', employerId)
      .order('createdAt', { ascending: false })
    if (error) throw error
    return (data ?? []).map(mapManagedJob)
  },

  createJob: async (payload: {
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
    description: string
    transportOffered: boolean
    transportFrom?: string
  }): Promise<ManagedJob> => {
    const created = await rpc<ManagedJobRow>('create_job', {
      p_title: payload.title,
      p_category: payload.category,
      p_city: payload.city,
      p_employment_type: employmentTypeInMap[payload.employmentType],
      p_date: payload.date,
      p_shift: shiftInMap[payload.shift],
      p_pay_type: toDb(payload.payType),
      p_hourly_pay: payload.hourlyPay,
      p_monthly_pay: payload.monthlyPay,
      p_workload: payload.workload ? toDb(payload.workload) : null,
      p_required_workers: payload.requiredWorkers,
      p_description: payload.description,
      p_transport_offered: payload.transportOffered,
      p_transport_from: payload.transportFrom ?? null,
    })
    return mapManagedJob(created)
  },

  closeJob: (jobId: number) => rpc<void>('close_job', { p_job_id: jobId }),

  getCandidates: async (jobId: number): Promise<Candidate[]> => {
    const rows = await rpc<Array<Omit<Candidate, 'rating' | 'distanceKm'> & { rating: number | null; distanceKm: number | null }>>(
      'candidate_feed',
      { p_job_id: jobId },
    )
    return rows.map((row) => ({ ...row, rating: toNumber(row.rating, 0), distanceKm: toNumberOrNull(row.distanceKm) }))
  },

  swipeCandidate: (jobId: number, workerId: number, direction: SwipeDirection) =>
    rpc<string>('swipe_candidate', { p_job_id: jobId, p_worker_id: workerId, p_direction: toDb(direction) }).then(
      (stage) => fromDb<ApplicationStage>(stage),
    ),

  rehireWorker: (workerId: number, jobId: number) => rpc<number>('rehire_worker', { p_worker_id: workerId, p_job_id: jobId }),

  sendJobOffer: (offer: JobOfferInput) =>
    rpc<number>('send_job_offer', {
      p_application_id: offer.applicationId,
      p_starts_at: offer.startsAt,
      p_ends_at: offer.endsAt,
      p_address: offer.address,
      p_pay_type: toDb(offer.payType),
      p_pay_amount: offer.payAmount,
      p_conditions: offer.conditions,
      p_response_minutes: offer.responseMinutes,
    }),

  cancelJobOffer: (offerId: number) => rpc<void>('cancel_job_offer', { p_offer_id: offerId }),

  completeShift: (applicationId: number, outcome: 'completed' | 'late' | 'no_show') =>
    rpc<void>('complete_shift', { p_application_id: applicationId, p_outcome: toDb(outcome) }),

  recordPayment: (applicationId: number, amount: number) =>
    rpc<void>('record_payment', { p_application_id: applicationId, p_amount: amount }),

  sendDocuments: async (payload: { jobId: number; documentUrl: string }): Promise<{ message: string }> => {
    const count = await rpc<number>('send_documents', { p_job_id: payload.jobId, p_document_url: payload.documentUrl })
    return { message: `קישור נשלח ל-${count} עובדים` }
  },

  requestSponsorship: (jobId: number | null, days: number) =>
    rpc<number>('request_sponsorship', { p_job_id: jobId, p_days: days }),

  // Both sides --------------------------------------------------------------------

  getMyApplications: async (): Promise<Application[]> =>
    (await rpc<ApplicationRow[]>('my_applications')).map(mapApplication),

  respondJobOffer: (offerId: number, accept: boolean) =>
    rpc<string>('respond_job_offer', { p_offer_id: offerId, p_accept: accept }).then((stage) => fromDb<ApplicationStage>(stage)),

  cancelHire: (applicationId: number, reason: string) =>
    rpc<void>('cancel_hire', { p_application_id: applicationId, p_reason: reason }),

  submitReview: (
    applicationId: number,
    review: { score?: number; payment?: number; environment?: number; clarity?: number; comment: string },
  ) =>
    rpc<void>('submit_review', {
      p_application_id: applicationId,
      p_score: review.score ?? null,
      p_payment: review.payment ?? null,
      p_environment: review.environment ?? null,
      p_clarity: review.clarity ?? null,
      p_comment: review.comment,
    }),

  getMessages: async (applicationId: number): Promise<ChatMessage[]> => {
    const { data, error } = await supabase
      .from('ChatMessage')
      .select('*')
      .eq('applicationId', applicationId)
      .order('createdAt', { ascending: true })
    if (error) throw error
    return (data ?? []).map(mapChatMessage)
  },

  sendMessage: async (applicationId: number, body: string | null, audioPath: string | null = null) =>
    mapChatMessage(
      await rpc<ChatMessageRow>('send_chat_message', {
        p_application_id: applicationId,
        p_body: body,
        p_audio_path: audioPath,
      }),
    ),

  uploadVoiceMessage: (applicationId: number, audio: Blob) =>
    uploadFile('chat-audio', String(applicationId), audio, 'webm'),

  getAudioUrl: (path: string) => signedUrl('chat-audio', path),

  subscribeToMessages: (applicationId: number, onMessage: (message: ChatMessage) => void) => {
    const channel = supabase
      .channel(`chat-${applicationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ChatMessage', filter: `applicationId=eq.${applicationId}` },
        (payload) => onMessage(mapChatMessage(payload.new as ChatMessageRow)),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  },

  getNotifications: async (): Promise<AppNotification[]> => {
    const { data, error } = await supabase
      .from('Notification')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(50)
    if (error) throw error
    return (data ?? []).map(mapNotification)
  },

  markNotificationsRead: (ids: number[] | null) => rpc<void>('mark_notifications_read', { p_ids: ids }),

  subscribeToNotifications: (userId: number, onChange: () => void) => {
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'Notification', filter: `userId=eq.${userId}` }, onChange)
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  },

  reportUser: (payload: { reportedId: number; reason: string; details: string; applicationId?: number; messageId?: number }) =>
    rpc<number>('report_user', {
      p_reported_id: payload.reportedId,
      p_reason: payload.reason,
      p_details: payload.details,
      p_application_id: payload.applicationId ?? null,
      p_message_id: payload.messageId ?? null,
    }),

  blockUser: (userId: number) => rpc<void>('block_user', { p_blocked_id: userId }),

  getBlockedUserIds: async (): Promise<number[]> => {
    const { data, error } = await supabase.from('UserBlock').select('blockedId')
    if (error) throw error
    return (data ?? []).map((row) => row.blockedId)
  },

  unblockUser: async (userId: number): Promise<void> => {
    const { error } = await supabase.from('UserBlock').delete().eq('blockedId', userId)
    if (error) throw error
  },

  // Admin ---------------------------------------------------------------------------

  getAdminOverview: () => rpc<AdminOverview>('admin_stats'),

  getAdminUsers: async (role?: UserRole): Promise<AdminUserRow[]> => {
    let usersQuery = supabase.from('User').select('*').order('createdAt', { ascending: false })
    if (role) {
      usersQuery = usersQuery.eq('role', roleInMap[role])
    }

    const { data: users, error } = await usersQuery
    if (error) throw error

    const ids = (users ?? []).map((user) => user.id)
    const [workerProfilesResult, employerProfilesResult] = await Promise.all([
      ids.length > 0 ? supabase.from('WorkerProfile').select('*').in('userId', ids) : Promise.resolve({ data: [], error: null }),
      ids.length > 0 ? supabase.from('EmployerProfile').select('*').in('userId', ids) : Promise.resolve({ data: [], error: null }),
    ])

    if (workerProfilesResult.error) throw workerProfilesResult.error
    if (employerProfilesResult.error) throw employerProfilesResult.error

    const workerByUserId = new Map((workerProfilesResult.data ?? []).map((row) => [row.userId, row]))
    const employerByUserId = new Map((employerProfilesResult.data ?? []).map((row) => [row.userId, row]))

    return (users ?? []).map((user) => {
      const worker = workerByUserId.get(user.id)
      const employer = employerByUserId.get(user.id)
      return {
        id: user.id,
        email: user.email,
        role: roleOutMap[user.role as 'WORKER' | 'EMPLOYER' | 'ADMIN'],
        isSuspended: user.isSuspended,
        suspendedUntil: user.suspendedUntil,
        suspensionReason: user.suspensionReason,
        contactViolations: user.contactViolations,
        createdAt: user.createdAt,
        worker: worker
          ? {
              fullName: worker.fullName,
              city: worker.city,
              rating: toNumber(worker.rating, 0),
              reliabilityScore: worker.reliabilityScore,
              verificationLevel: worker.verificationLevel === 'VERIFIED' ? 'verified' : 'basic',
            }
          : null,
        employer: employer
          ? {
              displayName: employer.displayName,
              isVerified: employer.isVerified,
              businessId: employer.businessId,
              legalName: employer.legalName,
              businessAddress: employer.businessAddress,
              representativeName: employer.representativeName,
              representativePhone: employer.representativePhone,
              verificationRequestedAt: employer.verificationRequestedAt,
              verificationNote: employer.verificationNote,
              subscriptionStatus: fromDb<SubscriptionStatus>(employer.subscriptionStatus),
              trialEndsAt: employer.trialEndsAt,
              activePlanId: employer.activePlanId,
              ratingAvg: toNumberOrNull(employer.ratingAvg),
              ratingCount: employer.ratingCount,
            }
          : null,
      }
    })
  },

  setUserSuspension: (id: number, isSuspended: boolean, reason?: string, days?: number) =>
    rpc<void>('admin_set_suspension', {
      p_user_id: id,
      p_suspended: isSuspended,
      p_reason: reason ?? null,
      p_days: days ?? null,
    }),

  verifyWorker: (userId: number, level: 'basic' | 'verified') =>
    rpc<void>('admin_verify_worker', { p_user_id: userId, p_level: toDb(level) }),

  verifyEmployer: (userId: number, approve: boolean, note?: string) =>
    rpc<void>('admin_decide_verification', { p_user_id: userId, p_approve: approve, p_note: note ?? null }),

  getContactViolations: async (): Promise<ContactViolationRow[]> => {
    const { data, error } = await supabase
      .from('ContactViolation')
      .select('*, user:User(email)')
      .order('createdAt', { ascending: false })
      .limit(100)
    if (error) throw error
    return (data ?? []).map((row) => ({
      id: row.id,
      userId: row.userId,
      email: row.user?.email ?? '',
      source: row.source,
      originalText: row.originalText,
      createdAt: row.createdAt,
    }))
  },

  getReports: async (): Promise<UserReportRow[]> => {
    const { data, error } = await supabase
      .from('UserReport')
      .select('*, reporter:User!UserReport_reporterId_fkey(email), reported:User!UserReport_reportedId_fkey(email)')
      .order('createdAt', { ascending: false })
      .limit(100)
    if (error) throw error
    return (data ?? []).map((row) => ({
      id: row.id,
      reporterEmail: row.reporter?.email ?? '',
      reportedId: row.reportedId,
      reportedEmail: row.reported?.email ?? '',
      applicationId: row.applicationId,
      messageId: row.messageId,
      reason: row.reason,
      details: row.details,
      status: fromDb(row.status),
      createdAt: row.createdAt,
    }))
  },

  resolveReport: (reportId: number, status: 'resolved' | 'dismissed', suspendReported: boolean) =>
    rpc<void>('admin_resolve_report', { p_report_id: reportId, p_status: toDb(status), p_suspend_reported: suspendReported }),

  deleteMessage: (messageId: number) => rpc<void>('admin_delete_message', { p_message_id: messageId }),

  getSponsorshipRequests: async (): Promise<SponsorshipRequestRow[]> => {
    const { data, error } = await supabase
      .from('SponsorshipRequest')
      .select('*, requester:User(email), job:Job(title)')
      .order('createdAt', { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) => ({
      id: row.id,
      requesterEmail: row.requester?.email ?? '',
      jobId: row.jobId,
      jobTitle: row.job?.title ?? null,
      days: row.days,
      status: fromDb(row.status),
      createdAt: row.createdAt,
    }))
  },

  decideSponsorship: (requestId: number, approve: boolean) =>
    rpc<void>('admin_decide_sponsorship', { p_request_id: requestId, p_approve: approve }),

  setSubscription: (userId: number, status: SubscriptionStatus, trialDays?: number) =>
    rpc<void>('admin_set_subscription', { p_user_id: userId, p_status: toDb(status), p_trial_days: trialDays ?? null }),

  saveCategory: async (category: { id?: number; name: string; requiredLicense: string | null; isActive: boolean }) => {
    const values = { name: category.name.trim(), requiredLicense: category.requiredLicense?.trim() || null, isActive: category.isActive }
    const { error } = category.id
      ? await supabase.from('JobCategory').update(values).eq('id', category.id)
      : await supabase.from('JobCategory').insert(values)
    if (error) throw error
  },

  getPendingLicenses: async (): Promise<PendingLicenseRow[]> => {
    const { data, error } = await supabase
      .from('WorkerLicense')
      .select('*, worker:User(email)')
      .eq('isVerified', false)
      .order('createdAt', { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) => ({
      id: row.id,
      workerEmail: row.worker?.email ?? '',
      name: row.name,
      expiresAt: row.expiresAt,
      filePath: row.filePath,
    }))
  },

  verifyLicense: (licenseId: number, verified: boolean) =>
    rpc<void>('admin_verify_license', { p_license_id: licenseId, p_verified: verified }),
}
