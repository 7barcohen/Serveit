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

function App() {
  const now = useNow(60000)
  const [view, setView] = useState<'worker' | 'employer' | 'admin'>('worker')
  const [workerTab, setWorkerTab] = useState<WorkerTab>('jobs')
  const [employerTab, setEmployerTab] = useState<EmployerTab>('home')
  const [designMood, setDesignMood] = useState<'sunset' | 'ocean'>('sunset')
  const [loading, setLoading] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [error, setError] = useState('')
  const [showLanding, setShowLanding] = useState(() => !readLandingSeen())

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authLoading, setAuthLoading] = useState(false)
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
          setError('ההרשמה נקלטה. צריך לאשר את כתובת האימייל במייל שנשלח ואז להתחבר.')
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
    if (sessionUser?.role === 'employer') setEmployerTab('chat')
    else setWorkerTab('chat')
  }

  const openNotification = (notification: AppNotification) => {
    void refreshAll()
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

  const appClassName = `app ${designMood === 'ocean' ? 'theme-ocean' : ''}`

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
              setAuthForm((prev) => ({ ...prev, role }))
            }}
            onLogin={() => {
              markLandingSeen()
              setShowLanding(false)
              setAuthMode('login')
            }}
          />
        </main>
      )
    }

    return (
      <main className={appClassName} dir="rtl">
        <section className="card auth-card">
          <p className="eyebrow">WorkAway</p>
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
                autoComplete="email"
                value={authForm.email}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </label>
            <label>
              סיסמה
              <input
                type="password"
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                value={authForm.password}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
              />
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
                        value={authForm.fullName}
                        onChange={(event) => setAuthForm((prev) => ({ ...prev, fullName: event.target.value }))}
                      />
                    </label>
                    <label>
                      עיר
                      <select
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
                        value={authForm.age}
                        onChange={(event) => setAuthForm((prev) => ({ ...prev, age: Number(event.target.value) }))}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    שם עסק
                    <input
                      value={authForm.displayName}
                      onChange={(event) => setAuthForm((prev) => ({ ...prev, displayName: event.target.value }))}
                    />
                  </label>
                )}
              </>
            )}

            <div className="swipe-actions">
              <button type="submit" className="primary" disabled={authLoading}>
                {authLoading ? 'טוען...' : authMode === 'login' ? 'התחבר' : 'צור חשבון'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setAuthMode((mode) => (mode === 'login' ? 'register' : 'login'))}
              >
                {authMode === 'login' ? 'אין לי חשבון' : 'כבר יש לי חשבון'}
              </button>
              <button type="button" className="ghost" onClick={() => setShowLanding(true)}>
                על WorkAway
              </button>
            </div>
          </form>

          {error && <p className="error-text">{error}</p>}
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
          <p className="eyebrow">WorkAway</p>
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
          <div className="theme-switch" role="group" aria-label="Theme switcher">
            <button
              type="button"
              className={designMood === 'sunset' ? 'active' : ''}
              onClick={() => setDesignMood('sunset')}
            >
              Sunset Pop
            </button>
            <button
              type="button"
              className={designMood === 'ocean' ? 'active' : ''}
              onClick={() => setDesignMood('ocean')}
            >
              Ocean Glow
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
        <section className="card">
          <p className="error-text">{error}</p>
        </section>
      )}

      {view === 'worker' && sessionUser.role === 'worker' && (
        <section className="worker-shell">
          <nav className="worker-dock">
            {workerTabs.map(([key, label]) => (
              <button key={key} type="button" className={workerTab === key ? 'active' : ''} onClick={() => setWorkerTab(key)}>
                {label}
                {key === 'myjobs' && applications.some((item) => item.stage === 'offered') ? ' •' : ''}
              </button>
            ))}
          </nav>

          {workerTab === 'jobs' && (
            <JobFeed
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
          <nav className="worker-dock">
            {employerTabs.map(([key, label]) => (
              <button key={key} type="button" className={employerTab === key ? 'active' : ''} onClick={() => setEmployerTab(key)}>
                {label}
              </button>
            ))}
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
        <span>WorkAway · פרטי קשר מוגנים בכל שלב</span>
        <span>שימוש חינמי לעובדים · חודשיים חינם למעסיקים חדשים</span>
      </footer>
    </main>
  )
}

export default App
