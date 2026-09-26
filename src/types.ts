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

export type Job = {
  id: number
  title: string
  category: string
  city: string
  region: Region | null
  employmentType: EmploymentType
  // For permanent jobs this is the start date.
  date: string
  shift: ShiftWindow
  hourlyPay: number
  description: string
  employerName: string
  transportOffered: boolean
  transportFrom?: string
  verifiedEmployer: boolean
}

// One saved search preference. A worker can have several; a job fits the worker
// if it matches any of them. Empty arrays mean "no restriction".
export type WorkerPreference = {
  id: number
  employmentType: EmploymentType
  minHourlyPay: number
  preferredShifts: ShiftWindow[]
  regions: Region[]
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
  rating: number
  verificationLevel: 'basic' | 'verified'
  tags: string[]
  isSuspended?: boolean
  preferences: WorkerPreference[]
}

export type ApplicationState = 'pending' | 'approved' | 'rejected'

export type UserRole = 'worker' | 'employer' | 'admin'

export type Application = {
  id: number
  jobId: number
  workerId: number
  state: ApplicationState
  canceledAt: string | null
  cancellationReason: string | null
  canceledBy: string | null
  penaltyPoints: number
}

export type EmployerPlan = {
  id: 'starter' | 'pro' | 'scale'
  name: string
  monthlyPrice: number
  openingsLimit: number
  features: string[]
}

export type BootstrapPayload = {
  jobs: Job[]
  workers: WorkerProfile[]
  applications: Application[]
  plans: EmployerPlan[]
  currentWorkerId: number | null
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
}

export type AdminOverview = {
  usersCount: number
  jobsCount: number
  appsCount: number
  pendingWorkers: number
  pendingEmployers: number
  suspendedUsers?: number
}

export type AdminUserRow = {
  id: number
  email: string
  role: UserRole
  isSuspended: boolean
  suspensionReason: string | null
  createdAt: string
  worker: {
    fullName: string
    city: string
    rating: number
    verificationLevel: 'basic' | 'verified'
  } | null
  employer: {
    displayName: string
    isVerified: boolean
  } | null
}

export type TrustReportRow = {
  userId: number
  email: string
  role: 'worker' | 'employer'
  totalPenalty: number
  isSuspended: boolean
  suspensionReason: string | null
}
