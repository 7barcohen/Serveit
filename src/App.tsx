import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import './App.css'
import { AdminPanel } from './components/AdminPanel'
import { CandidateSwipe } from './components/CandidateSwipe'
import { ChatPanel } from './components/ChatPanel'
import { CompanyProfile } from './components/CompanyProfile'
import { EmployerHistory } from './components/EmployerHistory'
import { EmployerHome } from './components/EmployerHome'
import { EmployerJobs } from './components/EmployerJobs'
import { JobFeed } from './components/JobFeed'
import { Landing } from './components/Landing'
import { NotificationCenter } from './components/NotificationCenter'
import { PreferencesPanel } from './components/PreferencesPanel'
import { WorkerMyJobs } from './components/WorkerMyJobs'
import { WorkerProfilePanel } from './components/WorkerProfilePanel'
import { formatDateTime } from './lib/labels'
import { errorMessage, useNow } from './lib/useNow'
import type {
  AppNotification,
  Application,
  AuthUser,
  City,
  EmployerPlan,
  EmployerProfile,
  Job,
  JobCategory,
  ManagedJob,
  UserRole,
  WorkerProfile,
} from './types'

type AuthMode = 'login' | 'register'
type WorkerTab = 'jobs' | 'myjobs' | 'chat' | 'profile' | 'preferences'
type EmployerTab = 'home' | 'candidates' | 'jobs' | 'chat' | 'history' | 'company'
type EmployerMobileTab = Exclude<EmployerTab, 'history' | 'company'>

const landingSeenKey = 'workaway.landingSeen'

const readLandingSeen = () => {
  try {
    return window.localStorage.getItem(landingSeenKey) === '1'
  } catch {
    return false
  }
}

const markLandingSeen = () => {
  try {
    window.localStorage.setItem(landingSeenKey, '1')
  } catch {
    // Private mode: the landing page will just show again next time.
  }
}

const workerTabs: Array<[WorkerTab, string]> = [
  ['jobs', 'משרות'],
  ['myjobs', 'המשרות שלי'],
  ['chat', 'צ׳אט'],
  ['profile', 'פרופיל'],
  ['preferences', 'העדפות'],
]

const employerTabs: Array<[EmployerTab, string]> = [
  ['home', 'בית'],
  ['candidates', 'מועמדים'],
  ['jobs', 'המשרות שלי'],
  ['chat', 'צ׳אט'],
  ['history', 'היסטוריה'],
  ['company', 'פרופיל חברה'],
]
const employerMobileTabs: EmployerMobileTab[] = ['home', 'candidates', 'jobs', 'chat']

const workerTabIcons: Record<WorkerTab, string> = {
  jobs: 'M4 5.5h16v14H4z M8 3.5v4m8-4v4M4 9h16',
  myjobs: 'M6 4h12a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2Z M9 8h6',
  chat: 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-9.5A7.5 7.5 0 0 1 10.5 4H12a8 8 0 0 1 8 7.5Z M8 11h8m-8 3h5',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
  preferences: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6 M15 7a2 2 0 1 0 0 .01ZM9 17a2 2 0 1 0 0 .01Z',
}

const employerTabIcons: Record<EmployerMobileTab | 'more', string> = {
  home: 'M3 11 12 4l9 7M5 10v10h14V10M9 20v-6h6v6',
  candidates: 'M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20m6-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7.5a4 4 0 0 1 0 7.5m3 9v-1.5a4.5 4.5 0 0 0-3.5-4.4',
  jobs: 'M4 5.5h16v14H4zM8 3.5v4m8-4v4M4 9h16',
  chat: 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-9.5A7.5 7.5 0 0 1 10.5 4H12a8 8 0 0 1 8 7.5Z M8 11h8m-8 3h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}

function App() {
  const now = useNow(60000)
  const [view, setView] = useState<'worker' | 'employer' | 'admin'>('worker')
  const [workerTab, setWorkerTab] = useState<WorkerTab>('jobs')
  const [employerTab, setEmployerTab] = useState<EmployerTab>('home')
  const [employerMoreOpen, setEmployerMoreOpen] = useState(false)
  const employerMoreRef = useRef<HTMLDivElement | null>(null)
  const employerMoreButtonRef = useRef<HTMLButtonElement | null>(null)
  const [designMood, setDesignMood] = useState<'sunset' | 'ocean'>('sunset')
  const [loading, setLoading] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [error, setError] = useState('')
  const [showLanding, setShowLanding] = useState(() => !readLandingSeen())

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authLoading, setAuthLoading] = useState(false)
  const [authSuccess, setAuthSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    role: 'worker' as Exclude<UserRole, 'admin'>,
    fullName: '',
    displayName: '',
    city: 'תל אביב',
    age: 20,
  })
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null)

  const [cities, setCities] = useState<City[]>([])
  const [categories, setCategories] = useState<JobCategory[]>([])
  const [plans, setPlans] = useState<EmployerPlan[]>([])

  const [workerProfile, setWorkerProfile] = useState<WorkerProfile | undefined>(undefined)
  const [jobs, setJobs] = useState<Job[]>([])
  const [employerProfile, setEmployerProfile] = useState<EmployerProfile | null>(null)
  const [managedJobs, setManagedJobs] = useState<ManagedJob[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null)
  const [candidateJobId, setCandidateJobId] = useState<number | null>(null)

  const loadReferenceData = useCallback(async () => {
    try {
      const [loadedCities, loadedCategories, loadedPlans] = await Promise.all([
        api.getCities(),
        api.getCategories(),
        api.getPlans(),
      ])
      setCities(loadedCities)
      setCategories(loadedCategories)
      setPlans(loadedPlans)
    } catch {
      setError('לא הצלחנו להתחבר לשרת.')
    }
  }, [])

  // Everything the signed-in user's screens need.
  const loadRoleData = useCallback(async (user: AuthUser) => {
    setError('')
    try {
      await api.processDueEvents().catch(() => undefined)
      if (user.role === 'worker') {
        const [profile, feed, apps] = await Promise.all([
          api.getWorkerProfile(user.id),
          api.getJobFeed(),
          api.getMyApplications(),
        ])
        setWorkerProfile(profile)
        setJobs(feed)
        setApplications(apps)
      } else if (user.role === 'employer') {
        const [profile, myJobs, apps] = await Promise.all([
          api.getEmployerProfile(user.id),
          api.getMyJobs(user.id),
          api.getMyApplications(),
        ])
        setEmployerProfile(profile)
        setManagedJobs(myJobs)
        setApplications(apps)
      }
    } catch (caught) {
      setError(errorMessage(caught, 'טעינת הנתונים נכשלה.'))
    }
  }, [])

  const refreshAll = useCallback(async () => {
    if (!sessionUser) return
    setLoading(true)
    try {
      const user = await api.getCurrentUser()
      setSessionUser(user)
      await loadRoleData(user)
    } catch (caught) {
      setError(errorMessage(caught, 'טעינת הנתונים נכשלה.'))
    } finally {
      setLoading(false)
    }
  }, [sessionUser, loadRoleData])

  useEffect(() => {
    void loadReferenceData()
  }, [loadReferenceData])

  useEffect(() => {
    if (!employerMoreOpen) return
    const closeOnPointerOutside = (event: PointerEvent) => {
      if (!employerMoreRef.current?.contains(event.target as Node)) setEmployerMoreOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setEmployerMoreOpen(false)
      employerMoreButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnPointerOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [employerMoreOpen])

  // Signs a user into the app shell once, whether the session came from a
  // page load, the auth listener or the login form.
  const enteredUserIdRef = useRef<number | null>(null)
  const enter = useCallback(
    async (user: AuthUser | null) => {
      setSessionUser(user)
      if (!user) {
        enteredUserIdRef.current = null
        setAuthReady(true)
        return
      }
      if (enteredUserIdRef.current === user.id) {
        setAuthReady(true)
        return
      }
      enteredUserIdRef.current = user.id
      markLandingSeen()
      setShowLanding(false)
      setView(user.role)
      setLoading(true)
      await loadRoleData(user)
      setLoading(false)
      setAuthReady(true)
    },
    [loadRoleData],
  )

  useEffect(() => {
    let isMounted = true

    const hydrateSession = async () => {
      try {
        const session = await api.getSession()
        const user = session ? await api.getCurrentUser() : null
        if (isMounted) await enter(user)
      } catch {
        if (isMounted) await enter(null)
      }
    }

    const unsubscribe = api.onAuthStateChange((user) => {
      if (isMounted) void enter(user)
    })

    void hydrateSession()

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [enter])

  // Keep countdowns, offer expiry and waitlist hand-offs fresh while the app is open.
  useEffect(() => {
    if (!sessionUser || sessionUser.role === 'admin') return
    const timer = window.setInterval(() => {
      void loadRoleData(sessionUser)
    }, 60000)
    return () => window.clearInterval(timer)
  }, [sessionUser, loadRoleData])

  const handleAuthSubmit = async () => {
    setAuthLoading(true)
    setError('')
    setAuthSuccess('')

    try {
      if (authMode === 'login') {
        await api.login({ email: authForm.email, password: authForm.password })
      } else {
        if (authForm.role === 'worker' && authForm.fullName.trim().length < 2) {
          setError('בהרשמת עובד צריך להזין שם מלא של לפחות 2 תווים.')
          return
        }

        if (authForm.role === 'employer' && authForm.displayName.trim().length < 2) {
          setError('בהרשמת מעסיק צריך להזין שם עסק של לפחות 2 תווים.')
          return
        }

        if (authForm.password.length < 6) {
          setError('הסיסמה צריכה להכיל לפחות 6 תווים.')
          return
        }

        const result = await api.register({
          email: authForm.email,
          password: authForm.password,
          role: authForm.role,
          fullName: authForm.fullName.trim() || undefined,
          displayName: authForm.displayName.trim() || undefined,
          city: authForm.city.trim() || undefined,
          age: authForm.age,
        })

        if (result.requiresEmailConfirmation) {
          setAuthSuccess('ההרשמה נקלטה. אשרי את כתובת האימייל דרך המייל שנשלח ואז התחברי.')
          setAuthMode('login')
          return
        }
      }

      await enter(await api.getCurrentUser())
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : ''
      if (message) {
        setError(message)
      } else {
        setError('התחברות/הרשמה נכשלה. בדוק פרטים ונסה שוב.')
      }
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    await api.logout()
    enteredUserIdRef.current = null
    setSessionUser(null)
    setWorkerProfile(undefined)
    setEmployerProfile(null)
    setApplications([])
    setJobs([])
    setManagedJobs([])
    setView('worker')
  }

  const openChat = (applicationId: number) => {
    setSelectedChatId(applicationId)
    if (sessionUser?.role === 'employer') {
      setEmployerTab('chat')
      setEmployerMoreOpen(false)
    }
    else setWorkerTab('chat')
  }

  const openNotification = (notification: AppNotification) => {
    void refreshAll()
    setEmployerMoreOpen(false)
    const chatTypes = ['match', 'message', 'offer', 'offer_accepted', 'offer_declined', 'offer_expired', 'waitlist_offer', 'hired']
    if (notification.applicationId && chatTypes.includes(notification.type)) {
      openChat(notification.applicationId)
      return
    }
    if (sessionUser?.role === 'worker') {
      if (notification.type === 'new_job') setWorkerTab('jobs')
      else if (['suspension', 'dlp_warning'].includes(notification.type)) setWorkerTab('profile')
      else setWorkerTab('myjobs')
    } else if (sessionUser?.role === 'employer') {
      if (notification.type === 'new_candidate') {
        setCandidateJobId(notification.jobId)
        setEmployerTab('candidates')
      } else if (['verification', 'subscription', 'sponsorship'].includes(notification.type)) setEmployerTab('company')
      else if (notification.type === 'review_request') setEmployerTab('history')
      else if (['job_filled', 'hire_canceled'].includes(notification.type)) setEmployerTab('jobs')
      else setEmployerTab('home')
    }
  }

  const appClassName = `app ${designMood === 'ocean' ? 'theme-ocean' : ''} ${sessionUser?.role === 'worker' ? 'worker-view-active' : ''} ${sessionUser?.role === 'worker' && workerTab === 'jobs' ? 'worker-job-feed-active' : ''} ${sessionUser?.role === 'employer' ? 'employer-view-active' : ''} ${sessionUser?.role === 'admin' ? 'admin-view-active' : ''}`

  if (!authReady) {
    return (
      <main className={appClassName} dir="rtl">
        <section className="card">
          <h2>טוען...</h2>
        </section>
      </main>
    )
  }

  if (!sessionUser) {
    if (showLanding) {
      return (
        <main className={appClassName} dir="rtl">
          <Landing
            onStart={(role) => {
              markLandingSeen()
              setShowLanding(false)
              setAuthMode('register')
              setAuthSuccess('')
              setError('')
              setAuthForm((prev) => ({ ...prev, role }))
            }}
            onLogin={() => {
              markLandingSeen()
              setShowLanding(false)
              setAuthMode('login')
              setAuthSuccess('')
              setError('')
            }}
          />
        </main>
      )
    }

    return (
      <main className={appClassName} dir="rtl">
        <section className="card auth-card">
          <p className="eyebrow">ShiftTed</p>
          <h2>{authMode === 'login' ? 'כניסה' : 'הרשמה'}</h2>
          <p className="subtitle">נכנסים ומתחילים למצוא עבודה או לפרסם משרות.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleAuthSubmit()
            }}
          >
            <label>
              אימייל
                <input
                type="email"
                  required
                autoComplete="email"
                  aria-describedby={error ? 'auth-error' : undefined}
                value={authForm.email}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </label>
            <label>
              סיסמה
              <span className="password-input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={authMode === 'register' ? 6 : undefined}
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  aria-describedby={error ? 'auth-error' : undefined}
                  value={authForm.password}
                  onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <button type="button" className="password-visibility" aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>
                  {showPassword ? 'הסתרה' : 'הצגה'}
                </button>
              </span>
            </label>

            {authMode === 'register' && (
              <>
                <label>
                  תפקיד
                  <select
                    value={authForm.role}
                    onChange={(event) =>
                      setAuthForm((prev) => ({
                        ...prev,
                        role: event.target.value as Exclude<UserRole, 'admin'>,
                      }))
                    }
                  >
                    <option value="worker">עובד/ת שמחפש/ת עבודה</option>
                    <option value="employer">מעסיק/ה</option>
                  </select>
                </label>
                {authForm.role === 'worker' ? (
                  <>
                    <label>
                      שם מלא
                      <input
                        required
                        value={authForm.fullName}
                        onChange={(event) => setAuthForm((prev) => ({ ...prev, fullName: event.target.value }))}
                      />
                    </label>
                    <label>
                      עיר
                      <select
                        required
                        value={authForm.city}
                        onChange={(event) => setAuthForm((prev) => ({ ...prev, city: event.target.value }))}
                      >
                        {cities.length === 0 && <option>{authForm.city}</option>}
                        {cities.map((city) => (
                          <option key={city.name}>{city.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      גיל
                      <input
                        type="number"
                        min={16}
                        max={99}
                        inputMode="numeric"
                        required
                        value={authForm.age}
                        onChange={(event) => setAuthForm((prev) => ({ ...prev, age: Number(event.target.value) }))}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    שם עסק
                    <input
                      required
                      value={authForm.displayName}
                      onChange={(event) => setAuthForm((prev) => ({ ...prev, displayName: event.target.value }))}
                    />
                  </label>
                )}
              </>
            )}

            {error && <p id="auth-error" className="error-text" role="alert" aria-live="assertive">{error}</p>}
            {authSuccess && <p className="auth-success" role="status" aria-live="polite">{authSuccess}</p>}
            <div className="swipe-actions auth-actions">
              <button type="submit" className="primary" disabled={authLoading}>
                {authLoading ? 'טוען...' : authMode === 'login' ? 'התחבר' : 'צור חשבון'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setAuthMode((mode) => (mode === 'login' ? 'register' : 'login'))
                  setError('')
                  setAuthSuccess('')
                }}
              >
                {authMode === 'login' ? 'אין לי חשבון' : 'כבר יש לי חשבון'}
              </button>
              <button type="button" className="ghost" onClick={() => setShowLanding(true)}>
                על ShiftTed
              </button>
            </div>
          </form>

        </section>
      </main>
    )
  }

  const employerHasAccess = employerProfile
    ? employerProfile.subscriptionStatus === 'active'
      || (employerProfile.subscriptionStatus === 'trial' && new Date(employerProfile.trialEndsAt).getTime() > now)
    : false
  const matchesCount = applications.filter((item) => item.matchedAt && ['matched', 'offered', 'hired', 'waitlisted'].includes(item.stage)).length

  return (
    <main className={appClassName} dir="rtl">
      <header className="topbar">
        <div>
          <p className="eyebrow">ShiftTed</p>
          <h1>{sessionUser.role === 'employer' ? 'העובדים הנכונים, בזמן' : 'מוצאים עבודה לפי הווייב שלך'}</h1>
          <p className="subtitle">{sessionUser.fullName ?? sessionUser.displayName ?? sessionUser.email}</p>
          <div className="pulse-stats">
            {sessionUser.role === 'worker' && (
              <>
                <span>{jobs.length} משרות חדשות</span>
                <span>{matchesCount} התאמות פעילות</span>
                <span>מדד אמינות {workerProfile?.reliabilityScore ?? '—'}</span>
              </>
            )}
            {sessionUser.role === 'employer' && (
              <>
                <span>{managedJobs.filter((job) => job.status === 'open').length} משרות פתוחות</span>
                <span>{matchesCount} התאמות פעילות</span>
              </>
            )}
          </div>
        </div>
        <div className="header-actions">
          <NotificationCenter userId={sessionUser.id} onOpen={openNotification} onActivity={() => void loadRoleData(sessionUser)} />
          <div className="role-toggle">
            <button
              type="button"
              onClick={() => setView('worker')}
              className={view === 'worker' ? 'active' : ''}
              disabled={sessionUser.role !== 'worker'}
            >
              עובד
            </button>
            <button
              type="button"
              onClick={() => setView('employer')}
              className={view === 'employer' ? 'active' : ''}
              disabled={sessionUser.role !== 'employer'}
            >
              מעסיק
            </button>
            <button
              type="button"
              onClick={() => setView('admin')}
              className={view === 'admin' ? 'active' : ''}
              disabled={sessionUser.role !== 'admin'}
            >
              אדמין
            </button>
          </div>
        </div>
      </header>

      <section className="card quick-actions">
        <div className="swipe-actions quick-tools">
          <div className="theme-switch" role="group" aria-label="ערכת צבעים">
            <button
              type="button"
              className={designMood === 'sunset' ? 'active' : ''}
              aria-pressed={designMood === 'sunset'}
              onClick={() => setDesignMood('sunset')}
            >
              שקיעה
            </button>
            <button
              type="button"
              className={designMood === 'ocean' ? 'active' : ''}
              aria-pressed={designMood === 'ocean'}
              onClick={() => setDesignMood('ocean')}
            >
              אוקיינוס
            </button>
          </div>
          <button type="button" className="ghost" onClick={() => void refreshAll()} disabled={loading}>
            {loading ? 'מרענן...' : 'רענון'}
          </button>
          <button type="button" className="ghost" onClick={() => void handleLogout()}>
            התנתקות
          </button>
        </div>
      </section>

      {sessionUser.isSuspended && (
        <section className="card suspended-banner" role="alert">
          <strong>
            החשבון מושעה{sessionUser.suspendedUntil ? ` עד ${formatDateTime(sessionUser.suspendedUntil)}` : ''}.
          </strong>
          <p>{sessionUser.suspensionReason ?? ''} בזמן ההשעיה אי אפשר להחליק, לשלוח הודעות או לקבל הצעות.</p>
        </section>
      )}

      {error && (
        <section className="card" role="alert" aria-live="assertive">
          <p className="error-text">{error}</p>
        </section>
      )}

      {view === 'worker' && sessionUser.role === 'worker' && (
        <section className="worker-shell">
          <nav className="worker-dock worker-dock-bottom" aria-label="ניווט עובד">
            {workerTabs.map(([key, label]) => (
                <button key={key} type="button" className={workerTab === key ? 'active' : ''} aria-current={workerTab === key ? 'page' : undefined} onClick={() => setWorkerTab(key)}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={workerTabIcons[key]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{label}{key === 'myjobs' && applications.some((item) => item.stage === 'offered') ? ' •' : ''}</span>
              </button>
            ))}
          </nav>

          {workerTab === 'jobs' && (
            <JobFeed
              key={sessionUser.id}
              userId={sessionUser.id}
              jobs={jobs}
              profile={workerProfile}
              cities={cities}
              loading={loading && jobs.length === 0}
              onSwiped={() => void api.getMyApplications().then(setApplications)}
              onOpenPreferences={() => setWorkerTab('preferences')}
              onOpenProfile={() => setWorkerTab('profile')}
            />
          )}
          {workerTab === 'myjobs' && (
            <WorkerMyJobs applications={applications} onChanged={() => void loadRoleData(sessionUser)} onOpenChat={openChat} />
          )}
          {workerTab === 'chat' && (
            <ChatPanel
              role="worker"
              meId={sessionUser.id}
              applications={applications}
              selectedId={selectedChatId}
              onSelect={setSelectedChatId}
              onChanged={() => void loadRoleData(sessionUser)}
            />
          )}
          {workerTab === 'profile' && workerProfile && (
            <WorkerProfilePanel
              profile={workerProfile}
              cities={cities}
              categories={categories}
              onChanged={() => void loadRoleData(sessionUser)}
            />
          )}
          {workerTab === 'preferences' && workerProfile && (
            <PreferencesPanel
              profile={workerProfile}
              cities={cities}
              categories={categories}
              onChanged={() => void loadRoleData(sessionUser)}
            />
          )}
        </section>
      )}

      {view === 'employer' && sessionUser.role === 'employer' && employerProfile && (
        <section className="worker-shell">
          <nav className="worker-dock employer-desktop-nav" aria-label="ניווט מעסיק">
            {employerTabs.map(([key, label]) => (
              <button key={key} type="button" className={employerTab === key ? 'active' : ''} aria-current={employerTab === key ? 'page' : undefined} onClick={() => setEmployerTab(key)}>
                {label}
              </button>
            ))}
          </nav>

          <nav className="employer-mobile-nav" aria-label="ניווט מעסיק">
            {employerMobileTabs.map((key) => {
              const label = employerTabs.find(([tab]) => tab === key)?.[1] ?? key
              return (
                <button key={key} type="button" className={employerTab === key ? 'active' : ''} aria-current={employerTab === key ? 'page' : undefined} onClick={() => { setEmployerTab(key); setEmployerMoreOpen(false) }}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={employerTabIcons[key]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span>{label}</span>
                </button>
              )
            })}
            <div className={`employer-more ${employerMoreOpen ? 'open' : ''}`} ref={employerMoreRef}>
              <button ref={employerMoreButtonRef} type="button" className={employerTab === 'history' || employerTab === 'company' || employerMoreOpen ? 'active' : ''} aria-expanded={employerMoreOpen} aria-controls="employer-more-menu" onClick={() => setEmployerMoreOpen((open) => !open)}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={employerTabIcons.more} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
                <span>עוד</span>
              </button>
              {employerMoreOpen && (
                <div className="employer-more-menu" id="employer-more-menu" aria-label="עוד אזורים">
                  <button type="button" aria-current={employerTab === 'history' ? 'page' : undefined} onClick={() => { setEmployerTab('history'); setEmployerMoreOpen(false); window.requestAnimationFrame(() => employerMoreButtonRef.current?.focus()) }}>היסטוריה</button>
                  <button type="button" aria-current={employerTab === 'company' ? 'page' : undefined} onClick={() => { setEmployerTab('company'); setEmployerMoreOpen(false); window.requestAnimationFrame(() => employerMoreButtonRef.current?.focus()) }}>פרופיל חברה</button>
                </div>
              )}
            </div>
          </nav>

          {employerTab === 'home' && (
            <EmployerHome
              profile={employerProfile}
              hasAccess={employerHasAccess}
              jobs={managedJobs}
              applications={applications}
              onOpenChat={openChat}
              onOpenCandidates={() => setEmployerTab('candidates')}
              onOpenCompany={() => setEmployerTab('company')}
              onOpenJobs={() => setEmployerTab('jobs')}
            />
          )}
          {employerTab === 'candidates' && (
            <CandidateSwipe
              jobs={managedJobs}
              selectedJobId={candidateJobId}
              onSelectJob={setCandidateJobId}
              onMatched={() => void loadRoleData(sessionUser)}
            />
          )}
          {employerTab === 'jobs' && (
            <EmployerJobs
              profile={employerProfile}
              hasAccess={employerHasAccess}
              jobs={managedJobs}
              applications={applications}
              cities={cities}
              categories={categories}
              plans={plans}
              onChanged={() => void loadRoleData(sessionUser)}
              onOpenCandidates={(jobId) => {
                setCandidateJobId(jobId)
                setEmployerTab('candidates')
              }}
              onOpenChat={openChat}
              onOpenCompany={() => setEmployerTab('company')}
            />
          )}
          {employerTab === 'chat' && (
            <ChatPanel
              role="employer"
              meId={sessionUser.id}
              defaultForm101Url={employerProfile?.form101Url}
              applications={applications}
              selectedId={selectedChatId}
              onSelect={setSelectedChatId}
              onChanged={() => void loadRoleData(sessionUser)}
            />
          )}
          {employerTab === 'history' && (
            <EmployerHistory
              jobs={managedJobs}
              applications={applications}
              onChanged={() => void loadRoleData(sessionUser)}
              onOpenChat={openChat}
            />
          )}
          {employerTab === 'company' && (
            <CompanyProfile
              key={employerProfile.id}
              profile={employerProfile}
              plans={plans}
              onChanged={() => void loadRoleData(sessionUser)}
            />
          )}
        </section>
      )}

      {view === 'admin' && sessionUser.role === 'admin' && (
        <AdminPanel plans={plans} categories={categories} onCategoriesChanged={() => void loadReferenceData()} />
      )}

      <footer className="footer">
        <span>ShiftTed · פרטי קשר מוגנים בכל שלב</span>
        <span>שימוש חינמי לעובדים · חודשיים חינם למעסיקים חדשים</span>
      </footer>
    </main>
  )
}

export default App
