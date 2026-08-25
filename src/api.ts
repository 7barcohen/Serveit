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
} from './types'

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
const runningOnLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
const configuredPointsToLocalhost =
  typeof configuredApiBase === 'string' && /localhost|127\.0\.0\.1/.test(configuredApiBase)

const apiBase = configuredApiBase
  ? configuredPointsToLocalhost && !runningOnLocalhost
    ? ''
    : configuredApiBase
  : import.meta.env.DEV
    ? 'http://localhost:4000'
    : ''

const fetchWithCookies = async (url: string, init?: RequestInit): Promise<Response> => {
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

const request = async <T>(path: string, init?: RequestInit, allowRefresh = true): Promise<T> => {
  const response = await fetchWithCookies(`${apiBase}${path}`, init)

  if ((response.status === 401 || response.status === 403) && allowRefresh) {
    const refreshed = await fetchWithCookies(`${apiBase}/api/auth/refresh`, {
      method: 'POST',
    })

    if (refreshed.ok) {
      return request<T>(path, init, false)
    }
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export const api = {
  getBootstrap: async (): Promise<BootstrapPayload> => {
    return request<BootstrapPayload>('/api/bootstrap', { method: 'GET' }, false)
  },

  getCurrentUser: async (): Promise<AuthUser> => {
    return request<AuthUser>('/api/auth/me', { method: 'GET' })
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
    return request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, false)
  },

  login: async (payload: { email: string; password: string }): Promise<AuthResponse> => {
    return request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, false)
  },

  logout: async (): Promise<void> => {
    await request<{ ok: true }>('/api/auth/logout', { method: 'POST' }, false)
  },

  createApplication: async (payload: { jobId: number; workerId: number }): Promise<Application> => {
    return request<Application>('/api/applications', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  updateApplication: async (id: number, state: ApplicationState): Promise<Application> => {
    return request<Application>(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    })
  },

  cancelApplication: async (id: number, reason: string): Promise<Application> => {
    return request<Application>(`/api/applications/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },

  reviewApplication: async (id: number, score: number, comment: string): Promise<{ id: number }> => {
    return request<{ id: number }>(`/api/applications/${id}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ score, comment: comment || undefined }),
    })
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
    return request<Job>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  sendDocuments: async (payload: { jobId: number; documentUrl: string }): Promise<{ message: string }> => {
    return request<{ message: string }>('/api/documents/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  getAdminOverview: async (): Promise<AdminOverview> => {
    return request<AdminOverview>('/api/admin/overview', { method: 'GET' })
  },

  getAdminUsers: async (role?: UserRole): Promise<AdminUserRow[]> => {
    const suffix = role ? `?role=${encodeURIComponent(role)}` : ''
    return request<AdminUserRow[]>(`/api/admin/users${suffix}`, { method: 'GET' })
  },

  getTrustReport: async (): Promise<{ rows: TrustReportRow[] }> => {
    return request<{ rows: TrustReportRow[] }>('/api/admin/trust-report', { method: 'GET' })
  },

  recalculateSuspensions: async (): Promise<{ ok: boolean; workers: number; employers: number }> => {
    return request<{ ok: boolean; workers: number; employers: number }>('/api/admin/suspensions/recalculate', {
      method: 'POST',
    })
  },

  setUserSuspension: async (id: number, isSuspended: boolean, reason?: string): Promise<void> => {
    await request<{ id: number }>(`/api/admin/users/${id}/suspension`, {
      method: 'PATCH',
      body: JSON.stringify({ isSuspended, reason }),
    })
  },

  verifyWorker: async (userId: number, level: 'basic' | 'verified'): Promise<void> => {
    await request<{ userId: number }>(`/api/admin/workers/${userId}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ level }),
    })
  },

  verifyEmployer: async (userId: number, verified: boolean): Promise<void> => {
    await request<{ userId: number }>(`/api/admin/employers/${userId}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ verified }),
    })
  },
}
