export type ShiftWindow = 'morning' | 'afternoon' | 'evening' | 'night'

export type Job = {
  id: number
  title: string
  category: string
  city: string
  date: string
  shift: ShiftWindow
  hourlyPay: number
  description: string
  employerName: string
  transportOffered: boolean
  transportFrom?: string
  verifiedEmployer: boolean
}

export type WorkerProfile = {
  id: number
  fullName: string
  age: number
  city: string
  rating: number
  verificationLevel: 'basic' | 'verified'
  tags: string[]
  isSuspended?: boolean
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
