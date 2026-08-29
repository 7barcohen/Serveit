import type {
  AdminOverview,
  AdminUserRow,
  Application,
  ApplicationState,
  AuthResponse,
  AuthUser,
  BootstrapPayload,
  Job,
  ShiftWindow,
  TrustReportRow,
  UserRole,
  WorkerProfile,
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

const appStateOutMap: Record<'PENDING' | 'APPROVED' | 'REJECTED', ApplicationState> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
}

const appStateInMap: Record<ApplicationState, 'PENDING' | 'APPROVED' | 'REJECTED'> = {
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
}

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const mapJob = (
  row: {
    id: number
    title: string
    category: string
    city: string
    date: string
    shift: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT'
    hourlyPay: number
    description: string
    transportOffered: boolean
    transportFrom: string | null
    verifiedEmployer: boolean
    employerId: number
  },
  employerName: string,
): Job => ({
  id: row.id,
  title: row.title,
  category: row.category,
  city: row.city,
  date: new Date(row.date).toISOString().slice(0, 10),
  shift: shiftOutMap[row.shift],
  hourlyPay: row.hourlyPay,
  description: row.description,
  employerName,
  transportOffered: row.transportOffered,
  transportFrom: row.transportFrom ?? undefined,
  verifiedEmployer: row.verifiedEmployer,
})

const mapApplication = (row: {
  id: number
  jobId: number
  workerId: number
  state: 'PENDING' | 'APPROVED' | 'REJECTED'
  canceledAt: string | null
  cancellationReason: string | null
  canceledBy: 'WORKER' | 'EMPLOYER' | 'ADMIN' | null
  penaltyPoints: number
}): Application => ({
  id: row.id,
  jobId: row.jobId,
  workerId: row.workerId,
  state: appStateOutMap[row.state],
  canceledAt: row.canceledAt,
  cancellationReason: row.cancellationReason,
  canceledBy: row.canceledBy?.toLowerCase() ?? null,
  penaltyPoints: row.penaltyPoints,
})

const isAppDataAccessError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('row-level security') ||
    message.includes('permission denied') ||
    message.includes('violates') ||
    message.includes('not found') ||
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('relation')
  )
}

const buildAuthUserFromSession = (params: {
  email: string
  role: UserRole
  fullName?: string
  displayName?: string
}): AuthUser => ({
  id: 0,
  email: params.email,
  role: params.role,
  fullName: params.fullName ?? null,
  displayName: params.displayName ?? null,
  isSuspended: false,
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

const getOptionalSessionUser = async () => {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    throw error
  }
  return data.session?.user ?? null
}

const extractRoleFromMeta = (meta: Record<string, unknown> | undefined): UserRole | null => {
  const role = meta?.role
  if (role === 'worker' || role === 'employer' || role === 'admin') {
    return role
  }
  return null
}

const getAppUserByEmail = async (email: string) => {
  const { data, error } = await supabase.from('User').select('*').eq('email', email).maybeSingle()
  if (error) {
    throw error
  }
  return data
}

const ensureAppUser = async (params: {
  email: string
  role: UserRole
  fullName?: string
  city?: string
  age?: number
  displayName?: string
}) => {
  const existing = await getAppUserByEmail(params.email)
  if (existing) {
    return existing
  }

  const { data: created, error } = await supabase
    .from('User')
    .insert({
      email: params.email,
      passwordHash: 'supabase-auth',
      role: roleInMap[params.role],
    })
    .select('*')
    .single()

  if (error || !created) {
    throw error ?? new Error('Failed creating user')
  }

  if (params.role === 'worker') {
    const { error: workerError } = await supabase.from('WorkerProfile').upsert(
      {
        userId: created.id,
        fullName: params.fullName ?? params.email.split('@')[0],
        age: params.age ?? 20,
        city: params.city ?? 'תל אביב',
        tags: ['נרשם דרך Supabase Auth'],
      },
      { onConflict: 'userId' },
    )
    if (workerError) {
      throw workerError
    }
  }

  if (params.role === 'employer') {
    const { data: starterPlan } = await supabase
      .from('EmployerPlan')
      .select('id')
      .eq('code', 'starter')
      .maybeSingle()

    const { error: employerError } = await supabase.from('EmployerProfile').upsert(
      {
        userId: created.id,
        displayName: params.displayName ?? params.email.split('@')[0],
        isVerified: false,
        activePlanId: starterPlan?.id ?? null,
      },
      { onConflict: 'userId' },
    )
    if (employerError) {
      throw employerError
    }
  }

  return created
}

const requireAppUserFromSession = async () => {
  const authUser = await getSessionUser()
  const fallbackRole = extractRoleFromMeta(authUser.user_metadata as Record<string, unknown> | undefined) ?? 'worker'
  try {
    const appUser = await ensureAppUser({
      email: authUser.email ?? '',
      role: fallbackRole,
    })
    return appUser
  } catch (error) {
    if (!isAppDataAccessError(error)) {
      throw error
    }

    return {
      id: 0,
      email: authUser.email ?? '',
      role: roleInMap[fallbackRole],
      isSuspended: false,
    }
  }
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
    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        handler(null)
        return
      }

      try {
        const user = await api.getCurrentUser()
        handler(user)
      } catch {
        handler(null)
      }
    })

    return () => data.subscription.unsubscribe()
  },

  getBootstrap: async (): Promise<BootstrapPayload> => {
    const [jobsResult, workersResult, applicationsResult, plansResult, usersResult, employerProfilesResult] =
      await Promise.all([
        supabase.from('Job').select('*').order('createdAt', { ascending: false }),
        supabase.from('WorkerProfile').select('*'),
        supabase.from('Application').select('*').order('createdAt', { ascending: false }),
        supabase.from('EmployerPlan').select('*').order('monthlyPrice', { ascending: true }),
        supabase.from('User').select('id,email,isSuspended'),
        supabase.from('EmployerProfile').select('userId,displayName'),
      ])

    if (jobsResult.error) throw jobsResult.error
    if (workersResult.error) throw workersResult.error
    if (applicationsResult.error) throw applicationsResult.error
    if (plansResult.error) throw plansResult.error
    if (usersResult.error) throw usersResult.error
    if (employerProfilesResult.error) throw employerProfilesResult.error

    const users = usersResult.data ?? []
    const workers = workersResult.data ?? []
    const employers = employerProfilesResult.data ?? []

    const usersById = new Map(users.map((user) => [user.id, user]))
    const employerByUserId = new Map(employers.map((profile) => [profile.userId, profile.displayName]))

    const jobs = (jobsResult.data ?? []).map((job) => {
      const employerUser = usersById.get(job.employerId)
      const employerName = employerByUserId.get(job.employerId) ?? employerUser?.email ?? 'מעסיק'
      return mapJob(job, employerName)
    })

    const mappedWorkers: WorkerProfile[] = workers.map((worker) => ({
      id: worker.userId,
      fullName: worker.fullName,
      age: worker.age,
      city: worker.city,
      rating: toNumber(worker.rating, 0),
      verificationLevel:
        worker.verificationLevel === 'VERIFIED'
          ? ('verified' as const)
          : ('basic' as const),
      tags: worker.tags ?? [],
      isSuspended: usersById.get(worker.userId)?.isSuspended ?? false,
    }))

    const plans = (plansResult.data ?? []).map((plan) => ({
      id: plan.code as 'starter' | 'pro' | 'scale',
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      openingsLimit: plan.openingsLimit,
      features: plan.features ?? [],
    }))

    const authUser = await getOptionalSessionUser()
    let currentWorkerId: number | null = null
    if (authUser?.email) {
      const appUser = users.find((user) => user.email === authUser.email)
      if (appUser && mappedWorkers.some((worker) => worker.id === appUser.id)) {
        currentWorkerId = appUser.id
      }
    }

    return {
      jobs,
      workers: mappedWorkers,
      applications: (applicationsResult.data ?? []).map((application) => mapApplication(application)),
      plans,
      currentWorkerId: currentWorkerId ?? mappedWorkers[0]?.id ?? null,
    }
  },

  getCurrentUser: async (): Promise<AuthUser> => {
    const authUser = await getSessionUser()
    const fallbackRole = extractRoleFromMeta(authUser.user_metadata as Record<string, unknown> | undefined) ?? 'worker'
    const metadataFullName =
      typeof authUser.user_metadata.fullName === 'string' ? authUser.user_metadata.fullName : undefined
    const metadataDisplayName =
      typeof authUser.user_metadata.displayName === 'string'
        ? authUser.user_metadata.displayName
        : undefined

    let appUser: Awaited<ReturnType<typeof ensureAppUser>>
    try {
      appUser = await ensureAppUser({
        email: authUser.email ?? '',
        role: fallbackRole,
        fullName: metadataFullName,
        displayName: metadataDisplayName,
        city: typeof authUser.user_metadata.city === 'string' ? authUser.user_metadata.city : undefined,
        age: typeof authUser.user_metadata.age === 'number' ? authUser.user_metadata.age : undefined,
      })
    } catch (error) {
      if (!isAppDataAccessError(error)) {
        throw error
      }

      return buildAuthUserFromSession({
        email: authUser.email ?? '',
        role: fallbackRole,
        fullName: metadataFullName,
        displayName: metadataDisplayName,
      })
    }

    let fullName: string | null = null
    let displayName: string | null = null

    if (appUser.role === 'WORKER') {
      const { data } = await supabase
        .from('WorkerProfile')
        .select('fullName')
        .eq('userId', appUser.id)
        .maybeSingle()
      fullName = data?.fullName ?? null
    }

    if (appUser.role === 'EMPLOYER') {
      const { data } = await supabase
        .from('EmployerProfile')
        .select('displayName')
        .eq('userId', appUser.id)
        .maybeSingle()
      displayName = data?.displayName ?? null
    }

    return {
      id: appUser.id,
      email: appUser.email,
      role: roleOutMap[appUser.role as 'WORKER' | 'EMPLOYER' | 'ADMIN'],
      fullName,
      displayName,
      isSuspended: appUser.isSuspended,
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

    let appUserId = 0
    try {
      const appUser = await ensureAppUser(payload)
      appUserId = appUser.id
    } catch (caughtError) {
      if (!isAppDataAccessError(caughtError)) {
        throw caughtError
      }
    }

    return {
      role: payload.role,
      userId: appUserId,
      requiresEmailConfirmation: !data.session,
    }
  },

  login: async (payload: { email: string; password: string }): Promise<AuthResponse> => {
    const { data, error } = await supabase.auth.signInWithPassword(payload)
    if (error || !data.user) {
      throw error ?? new Error('Login failed')
    }

    const roleFromMeta = extractRoleFromMeta(data.user.user_metadata as Record<string, unknown> | undefined)
    let appUserId = 0
    let appRole = roleFromMeta ?? 'worker'
    try {
      const appUser = await ensureAppUser({
        email: payload.email,
        role: roleFromMeta ?? 'worker',
      })
      appUserId = appUser.id
      appRole = roleOutMap[appUser.role as 'WORKER' | 'EMPLOYER' | 'ADMIN']
    } catch (caughtError) {
      if (!isAppDataAccessError(caughtError)) {
        throw caughtError
      }
    }

    return {
      role: appRole,
      userId: appUserId,
    }
  },

  logout: async (): Promise<void> => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  createApplication: async (payload: { jobId: number; workerId: number }): Promise<Application> => {
    const appUser = await requireAppUserFromSession()
    if (appUser.role !== 'WORKER' && appUser.role !== 'ADMIN') {
      throw new Error('Forbidden')
    }
    if (appUser.role === 'WORKER' && appUser.id !== payload.workerId) {
      throw new Error('Worker can apply only for self')
    }

    const [{ data: existing, error: existingError }, { data: job, error: jobError }] = await Promise.all([
      supabase
        .from('Application')
        .select('*')
        .eq('jobId', payload.jobId)
        .eq('workerId', payload.workerId)
        .maybeSingle(),
      supabase.from('Job').select('*').eq('id', payload.jobId).maybeSingle(),
    ])

    if (existingError) throw existingError
    if (jobError) throw jobError
    if (!job) throw new Error('Job not found')

    if (existing) {
      return mapApplication(existing)
    }

    const autoApproved = job.hourlyPay >= 60 && job.verifiedEmployer
    const { data: created, error } = await supabase
      .from('Application')
      .insert({
        jobId: payload.jobId,
        workerId: payload.workerId,
        state: autoApproved ? 'APPROVED' : 'PENDING',
      })
      .select('*')
      .single()

    if (error || !created) throw error ?? new Error('Application create failed')
    return mapApplication(created)
  },

  updateApplication: async (id: number, state: ApplicationState): Promise<Application> => {
    const appUser = await requireAppUserFromSession()
    if (appUser.role !== 'EMPLOYER' && appUser.role !== 'ADMIN') {
      throw new Error('Forbidden')
    }

    const { data: target, error: targetError } = await supabase
      .from('Application')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (targetError) throw targetError
    if (!target) throw new Error('Application not found')

    if (appUser.role === 'EMPLOYER') {
      const { data: job, error: jobError } = await supabase
        .from('Job')
        .select('employerId')
        .eq('id', target.jobId)
        .maybeSingle()
      if (jobError) throw jobError
      if (!job || job.employerId !== appUser.id) {
        throw new Error('Forbidden')
      }
    }

    const { data: updated, error } = await supabase
      .from('Application')
      .update({ state: appStateInMap[state] })
      .eq('id', id)
      .select('*')
      .single()

    if (error || !updated) throw error ?? new Error('Update failed')
    return mapApplication(updated)
  },

  cancelApplication: async (id: number, reason: string): Promise<Application> => {
    const appUser = await requireAppUserFromSession()
    const { data: target, error: targetError } = await supabase
      .from('Application')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (targetError) throw targetError
    if (!target) throw new Error('Application not found')

    const { data: job, error: jobError } = await supabase
      .from('Job')
      .select('employerId')
      .eq('id', target.jobId)
      .maybeSingle()
    if (jobError) throw jobError
    if (!job) throw new Error('Job not found')

    const canCancel =
      appUser.role === 'ADMIN' || target.workerId === appUser.id || (appUser.role === 'EMPLOYER' && job.employerId === appUser.id)

    if (!canCancel) {
      throw new Error('Forbidden')
    }

    const canceledBy = appUser.role === 'ADMIN' ? 'ADMIN' : appUser.role === 'EMPLOYER' ? 'EMPLOYER' : 'WORKER'
    const penaltyPoints = canceledBy === 'WORKER' ? 5 : canceledBy === 'EMPLOYER' ? 3 : 0

    const { data: updated, error } = await supabase
      .from('Application')
      .update({
        state: 'REJECTED',
        canceledAt: new Date().toISOString(),
        canceledBy,
        cancellationReason: reason,
        penaltyPoints,
      })
      .eq('id', id)
      .select('*')
      .single()

    if (error || !updated) throw error ?? new Error('Cancel failed')
    return mapApplication(updated)
  },

  reviewApplication: async (id: number, score: number, comment: string): Promise<{ id: number }> => {
    const appUser = await requireAppUserFromSession()

    const { data: target, error: targetError } = await supabase
      .from('Application')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (targetError) throw targetError
    if (!target || target.state !== 'APPROVED') {
      throw new Error('Only approved matches can be reviewed')
    }

    const isWorkerOwner = appUser.id === target.workerId

    if (!isWorkerOwner) {
      const { data: job, error: jobError } = await supabase
        .from('Job')
        .select('employerId')
        .eq('id', target.jobId)
        .maybeSingle()
      if (jobError) throw jobError
      if (!job || (appUser.role !== 'ADMIN' && job.employerId !== appUser.id)) {
        throw new Error('Forbidden')
      }
    }

    const { data: review, error } = await supabase
      .from('ApplicationReview')
      .upsert(
        {
          applicationId: id,
          reviewerId: appUser.id,
          score,
          comment: comment || null,
        },
        { onConflict: 'applicationId,reviewerId' },
      )
      .select('id')
      .single()

    if (error || !review) throw error ?? new Error('Review failed')

    if (!isWorkerOwner) {
      const { data: workerApps, error: workerAppsError } = await supabase
        .from('Application')
        .select('id')
        .eq('workerId', target.workerId)
      if (workerAppsError) throw workerAppsError

      const ids = (workerApps ?? []).map((entry) => entry.id)
      if (ids.length > 0) {
        const { data: reviews, error: reviewsError } = await supabase
          .from('ApplicationReview')
          .select('score')
          .in('applicationId', ids)
        if (reviewsError) throw reviewsError

        const ratings = (reviews ?? []).map((entry) => toNumber(entry.score, 0)).filter((value) => value > 0)
        const average = ratings.length > 0 ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0

        const { error: ratingError } = await supabase
          .from('WorkerProfile')
          .update({ rating: Number(average.toFixed(2)) })
          .eq('userId', target.workerId)
        if (ratingError) throw ratingError
      }
    }

    return { id: review.id }
  },

  createJob: async (payload: {
    title: string
    category: string
    city: string
    date: string
    shift: ShiftWindow
    hourlyPay: number
    transportOffered: boolean
    transportFrom?: string
  }): Promise<Job> => {
    const appUser = await requireAppUserFromSession()
    if (appUser.role !== 'EMPLOYER' && appUser.role !== 'ADMIN') {
      throw new Error('Forbidden')
    }

    const employerId = appUser.id
    if (appUser.role === 'EMPLOYER') {
      const { data: profile, error: profileError } = await supabase
        .from('EmployerProfile')
        .select('activePlanId')
        .eq('userId', employerId)
        .maybeSingle()
      if (profileError) throw profileError
      if (!profile) throw new Error('Employer profile missing')

      if (profile.activePlanId) {
        const [{ data: plan, error: planError }, { count, error: countError }] = await Promise.all([
          supabase
            .from('EmployerPlan')
            .select('openingsLimit')
            .eq('id', profile.activePlanId)
            .maybeSingle(),
          supabase.from('Job').select('*', { count: 'exact', head: true }).eq('employerId', employerId),
        ])

        if (planError) throw planError
        if (countError) throw countError
        if (plan && (count ?? 0) >= plan.openingsLimit) {
          throw new Error('Plan limit reached')
        }
      }
    }

    const { data: created, error } = await supabase
      .from('Job')
      .insert({
        title: payload.title,
        category: payload.category,
        city: payload.city,
        date: new Date(payload.date).toISOString(),
        shift: shiftInMap[payload.shift],
        hourlyPay: payload.hourlyPay,
        description: 'משרה חדשה שנוצרה על ידי המעסיק דרך Supabase.',
        transportOffered: payload.transportOffered,
        transportFrom: payload.transportFrom ?? null,
        verifiedEmployer: true,
        employerId,
      })
      .select('*')
      .single()

    if (error || !created) throw error ?? new Error('Create job failed')

    const { data: employerProfile } = await supabase
      .from('EmployerProfile')
      .select('displayName')
      .eq('userId', employerId)
      .maybeSingle()

    return mapJob(created, employerProfile?.displayName ?? appUser.email)
  },

  sendDocuments: async (payload: { jobId: number; documentUrl: string }): Promise<{ message: string }> => {
    const appUser = await requireAppUserFromSession()
    if (appUser.role !== 'EMPLOYER' && appUser.role !== 'ADMIN') {
      throw new Error('Forbidden')
    }

    const { data: job, error: jobError } = await supabase.from('Job').select('*').eq('id', payload.jobId).maybeSingle()
    if (jobError) throw jobError
    if (!job) throw new Error('Job not found')

    if (appUser.role === 'EMPLOYER' && job.employerId !== appUser.id) {
      throw new Error('Forbidden')
    }

    const { data: approved, error: approvedError } = await supabase
      .from('Application')
      .select('workerId')
      .eq('jobId', payload.jobId)
      .eq('state', 'APPROVED')
    if (approvedError) throw approvedError

    if (!approved || approved.length === 0) {
      throw new Error('Documents can be sent only after approved matches exist')
    }

    const recipients = approved.map((entry) => entry.workerId)
    const { error } = await supabase.from('DocumentDispatch').insert({
      jobId: payload.jobId,
      documentUrl: payload.documentUrl,
      recipients,
    })
    if (error) throw error

    return { message: `קישור נשלח ל-${recipients.length} עובדים` }
  },

  getAdminOverview: async (): Promise<AdminOverview> => {
    const [users, jobs, apps, pendingWorkers, pendingEmployers, suspendedUsers] = await Promise.all([
      supabase.from('User').select('*', { count: 'exact', head: true }),
      supabase.from('Job').select('*', { count: 'exact', head: true }),
      supabase.from('Application').select('*', { count: 'exact', head: true }),
      supabase.from('WorkerProfile').select('*', { count: 'exact', head: true }).eq('verificationLevel', 'BASIC'),
      supabase.from('EmployerProfile').select('*', { count: 'exact', head: true }).eq('isVerified', false),
      supabase.from('User').select('*', { count: 'exact', head: true }).eq('isSuspended', true),
    ])

    if (users.error) throw users.error
    if (jobs.error) throw jobs.error
    if (apps.error) throw apps.error
    if (pendingWorkers.error) throw pendingWorkers.error
    if (pendingEmployers.error) throw pendingEmployers.error
    if (suspendedUsers.error) throw suspendedUsers.error

    return {
      usersCount: users.count ?? 0,
      jobsCount: jobs.count ?? 0,
      appsCount: apps.count ?? 0,
      pendingWorkers: pendingWorkers.count ?? 0,
      pendingEmployers: pendingEmployers.count ?? 0,
      suspendedUsers: suspendedUsers.count ?? 0,
    }
  },

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

    return (users ?? []).map((user) => ({
      id: user.id,
      email: user.email,
      role: roleOutMap[user.role as 'WORKER' | 'EMPLOYER' | 'ADMIN'],
      isSuspended: user.isSuspended,
      suspensionReason: user.suspensionReason,
      createdAt: user.createdAt,
      worker: workerByUserId.get(user.id)
        ? {
            fullName: workerByUserId.get(user.id)!.fullName,
            city: workerByUserId.get(user.id)!.city,
            rating: toNumber(workerByUserId.get(user.id)!.rating, 0),
            verificationLevel:
              workerByUserId.get(user.id)!.verificationLevel === 'VERIFIED' ? 'verified' : 'basic',
          }
        : null,
      employer: employerByUserId.get(user.id)
        ? {
            displayName: employerByUserId.get(user.id)!.displayName,
            isVerified: employerByUserId.get(user.id)!.isVerified,
          }
        : null,
    }))
  },

  getTrustReport: async (): Promise<{ rows: TrustReportRow[] }> => {
    const [usersResult, appsResult, jobsResult] = await Promise.all([
      supabase.from('User').select('id,email,role,isSuspended,suspensionReason').in('role', ['WORKER', 'EMPLOYER']),
      supabase.from('Application').select('workerId,jobId,penaltyPoints,canceledBy'),
      supabase.from('Job').select('id,employerId'),
    ])

    if (usersResult.error) throw usersResult.error
    if (appsResult.error) throw appsResult.error
    if (jobsResult.error) throw jobsResult.error

    const users = usersResult.data ?? []
    const apps = appsResult.data ?? []
    const jobs = jobsResult.data ?? []

    const jobEmployerMap = new Map(jobs.map((job) => [job.id, job.employerId]))
    const workerPenalties = new Map<number, number>()
    const employerPenalties = new Map<number, number>()

    for (const app of apps) {
      if (!app.penaltyPoints || app.penaltyPoints <= 0 || !app.canceledBy) {
        continue
      }
      if (app.canceledBy === 'WORKER') {
        workerPenalties.set(app.workerId, (workerPenalties.get(app.workerId) ?? 0) + app.penaltyPoints)
      }
      if (app.canceledBy === 'EMPLOYER') {
        const employerId = jobEmployerMap.get(app.jobId)
        if (employerId) {
          employerPenalties.set(employerId, (employerPenalties.get(employerId) ?? 0) + app.penaltyPoints)
        }
      }
    }

    const rows: TrustReportRow[] = users.map((user) => {
      const role = roleOutMap[user.role as 'WORKER' | 'EMPLOYER' | 'ADMIN']
      const totalPenalty =
        role === 'worker' ? workerPenalties.get(user.id) ?? 0 : employerPenalties.get(user.id) ?? 0

      return {
        userId: user.id,
        email: user.email,
        role: role === 'worker' ? 'worker' : 'employer',
        totalPenalty,
        isSuspended: user.isSuspended,
        suspensionReason: user.suspensionReason,
      }
    })

    rows.sort((a, b) => b.totalPenalty - a.totalPenalty)
    return { rows }
  },

  recalculateSuspensions: async (): Promise<{ ok: boolean; workers: number; employers: number }> => {
    const report = await api.getTrustReport()
    const workerRows = report.rows.filter((row) => row.role === 'worker')
    const employerRows = report.rows.filter((row) => row.role === 'employer')

    const workerSuspended = workerRows.filter((row) => row.totalPenalty >= 20)
    const employerSuspended = employerRows.filter((row) => row.totalPenalty >= 12)

    const updates = report.rows.map((row) => {
      const shouldSuspend = row.role === 'worker' ? row.totalPenalty >= 20 : row.totalPenalty >= 12
      return supabase
        .from('User')
        .update({
          isSuspended: shouldSuspend,
          suspendedAt: shouldSuspend ? new Date().toISOString() : null,
          suspensionReason: shouldSuspend ? `Auto suspension: penalties=${row.totalPenalty}` : null,
        })
        .eq('id', row.userId)
    })

    await Promise.all(updates)

    return {
      ok: true,
      workers: workerSuspended.length,
      employers: employerSuspended.length,
    }
  },

  setUserSuspension: async (id: number, isSuspended: boolean, reason?: string): Promise<void> => {
    const { error } = await supabase
      .from('User')
      .update({
        isSuspended,
        suspendedAt: isSuspended ? new Date().toISOString() : null,
        suspensionReason: isSuspended ? reason ?? 'Suspended by admin' : null,
      })
      .eq('id', id)

    if (error) throw error
  },

  verifyWorker: async (userId: number, level: 'basic' | 'verified'): Promise<void> => {
    const { error } = await supabase
      .from('WorkerProfile')
      .update({ verificationLevel: level === 'verified' ? 'VERIFIED' : 'BASIC' })
      .eq('userId', userId)

    if (error) throw error
  },

  verifyEmployer: async (userId: number, verified: boolean): Promise<void> => {
    const { error } = await supabase.from('EmployerProfile').update({ isVerified: verified }).eq('userId', userId)
    if (error) throw error
  },
}
