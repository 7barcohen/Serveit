import { useState } from 'react'
import { api } from '../api'
import { formatDate, formatRating, regionLabels, regionOptions, subscriptionLabels } from '../lib/labels'
import { errorMessage, useNow } from '../lib/useNow'
import { isValidIsraeliId } from '../lib/validation'
import type { EmployerPlan, EmployerProfile, Region } from '../types'

type Props = {
  profile: EmployerProfile
  plans: EmployerPlan[]
  onChanged: () => void
}

const MAX_PHOTOS = 6

// Company profile, business verification and subscription (spec §1.2, §6.2).
export function CompanyProfile({ profile, plans, onChanged }: Props) {
  const [publicForm, setPublicForm] = useState({
    displayName: profile.displayName,
    description: profile.description,
    regions: profile.regions,
    form101Url: profile.form101Url ?? '',
    logoPath: profile.logoPath,
    photoPaths: profile.photoPaths,
  })
  const [verification, setVerification] = useState({
    businessId: profile.businessId ?? '',
    legalName: profile.legalName ?? '',
    businessAddress: profile.businessAddress ?? '',
    representativeName: profile.representativeName ?? '',
    representativePhone: profile.representativePhone ?? '',
  })
  const [selectedPlan, setSelectedPlan] = useState<EmployerPlan['id']>(
    plans.find((plan) => plan.dbId === profile.activePlanId)?.id ?? 'pro',
  )
  const now = useNow(60000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'השמירה נכשלה.'))
    } finally {
      setBusy(false)
    }
  }

  const savePublic = (patch: Partial<typeof publicForm> = {}) => {
    const next = { ...publicForm, ...patch }
    if (next.displayName.trim().length < 2) {
      setError('יש להזין שם עסק.')
      return
    }
    if (next.form101Url && !/^https:\/\/\S+$/.test(next.form101Url.trim())) {
      setError('קישור טופס 101 חייב להתחיל ב-https://')
      return
    }
    setPublicForm(next)
    void run(
      () =>
        api.updateEmployerProfile(profile.id, {
          displayName: next.displayName.trim(),
          description: next.description.trim(),
          regions: next.regions,
          form101Url: next.form101Url.trim() || null,
          logoPath: next.logoPath,
          photoPaths: next.photoPaths,
        }),
      'פרופיל החברה נשמר.',
    )
  }

  const uploadImage = async (file: File | undefined, kind: 'logo' | 'photo') => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('אפשר להעלות רק תמונות.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('התמונה גדולה מדי (עד 5MB).')
      return
    }
    setBusy(true)
    setError('')
    try {
      const path = await api.uploadCompanyMedia(profile.id, file)
      setBusy(false)
      if (kind === 'logo') savePublic({ logoPath: path })
      else savePublic({ photoPaths: [...publicForm.photoPaths, path].slice(0, MAX_PHOTOS) })
    } catch (caught) {
      setBusy(false)
      setError(errorMessage(caught, 'העלאת התמונה נכשלה.'))
    }
  }

  const submitVerification = () => {
    if (!isValidIsraeliId(verification.businessId)) {
      setError('מספר ח.פ. / עוסק מורשה אינו תקין.')
      return
    }
    void run(() => api.requestBusinessVerification(verification), 'פרטי העסק נשלחו לאימות. נעדכן בהתראה.')
  }

  const verificationStatus = profile.isVerified
    ? { label: 'העסק מאומת ✓', className: 'status-box' }
    : profile.verificationRequestedAt
      ? { label: `ממתין לאישור (נשלח ${formatDate(profile.verificationRequestedAt)})`, className: 'status-box' }
      : profile.verificationNote
        ? { label: `האימות נדחה: ${profile.verificationNote}`, className: 'error-text' }
        : { label: 'לא נשלח עדיין. אימות עסק הוא חובה לפני פרסום משרות.', className: 'error-text' }

  const trialActive = profile.subscriptionStatus === 'trial' && new Date(profile.trialEndsAt).getTime() > now

  return (
    <section className="panel employer-grid">
      {(error || notice) && (
        <article className="card full-row">
          {error && <p className="error-text">{error}</p>}
          {notice && <p className="status-box">{notice}</p>}
        </article>
      )}

      <article className="card">
        <h2>פרופיל חברה ציבורי</h2>
        <p className="empty">זה מה שעובדים רואים בכרטיסיית המשרה. {formatRating(profile.ratingAvg, profile.ratingCount)}</p>
        <div className="logo-row">
          {profile.logoUrl ? <img className="company-logo large" src={profile.logoUrl} alt="לוגו" /> : <span className="company-logo placeholder large">{profile.displayName.slice(0, 1)}</span>}
          <label className="ghost file-button">
            {profile.logoUrl ? 'החלפת לוגו' : 'העלאת לוגו'}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(event) => void uploadImage(event.target.files?.[0], 'logo')} />
          </label>
        </div>
        <label>
          שם העסק
          <input value={publicForm.displayName} onChange={(event) => setPublicForm({ ...publicForm, displayName: event.target.value })} />
        </label>
        <label>
          תיאור העסק
          <textarea
            rows={4}
            maxLength={1000}
            value={publicForm.description}
            onChange={(event) => setPublicForm({ ...publicForm, description: event.target.value })}
          />
        </label>
        <div className="choice-group">
          <span>אזורי פעילות</span>
          <div className="pill-row">
            {regionOptions.map((region: Region) => (
              <button
                key={region}
                type="button"
                className={`pill ${publicForm.regions.includes(region) ? 'selected' : ''}`}
                onClick={() =>
                  setPublicForm({
                    ...publicForm,
                    regions: publicForm.regions.includes(region)
                      ? publicForm.regions.filter((item) => item !== region)
                      : [...publicForm.regions, region],
                  })
                }
              >
                {regionLabels[region]}
              </button>
            ))}
          </div>
        </div>
        <label>
          קישור לטופס 101 דיגיטלי
          <input
            value={publicForm.form101Url}
            placeholder="https://..."
            onChange={(event) => setPublicForm({ ...publicForm, form101Url: event.target.value })}
          />
        </label>
        <p className="empty">נשלח אוטומטית לכל עובד/ת שמאשר/ת הצעת עבודה. חובה לפני שליחת הצעות.</p>
        <button type="button" className="primary" onClick={() => savePublic()} disabled={busy}>
          שמירה
        </button>

        <h3>תמונות מסביבת העבודה</h3>
        <div className="photo-grid">
          {profile.photoUrls.map((url, index) => (
            <figure key={url}>
              <img src={url} alt="סביבת העבודה" />
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => savePublic({ photoPaths: publicForm.photoPaths.filter((_, i) => i !== index) })}
              >
                הסרה
              </button>
            </figure>
          ))}
        </div>
        {publicForm.photoPaths.length < MAX_PHOTOS && (
          <label className="ghost file-button">
            הוספת תמונה
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(event) => void uploadImage(event.target.files?.[0], 'photo')} />
          </label>
        )}
      </article>

      <article className="card">
        <h2>אימות עסק</h2>
        <p className={verificationStatus.className}>{verificationStatus.label}</p>
        <p className="empty">הפרטים האלה גלויים רק לצוות WorkAway, לא לעובדים.</p>
        <label>
          ח.פ. / עוסק מורשה
          <input
            inputMode="numeric"
            value={verification.businessId}
            onChange={(event) => setVerification({ ...verification, businessId: event.target.value })}
          />
        </label>
        <label>
          שם חברה רשמי
          <input value={verification.legalName} onChange={(event) => setVerification({ ...verification, legalName: event.target.value })} />
        </label>
        <label>
          כתובת פיזית
          <input
            value={verification.businessAddress}
            onChange={(event) => setVerification({ ...verification, businessAddress: event.target.value })}
          />
        </label>
        <label>
          שם נציג/ה מורשה
          <input
            value={verification.representativeName}
            onChange={(event) => setVerification({ ...verification, representativeName: event.target.value })}
          />
        </label>
        <label>
          טלפון נציג/ה
          <input
            inputMode="tel"
            value={verification.representativePhone}
            onChange={(event) => setVerification({ ...verification, representativePhone: event.target.value })}
          />
        </label>
        <button type="button" className="primary" onClick={submitVerification} disabled={busy}>
          {profile.verificationRequestedAt || profile.isVerified ? 'עדכון ושליחה מחדש לאימות' : 'שליחה לאימות'}
        </button>
      </article>

      <article className="card full-row">
        <h2>מנוי</h2>
        <p>
          סטטוס: <strong>{subscriptionLabels[profile.subscriptionStatus]}</strong>
          {trialActive && ` · חודשיים חינם עד ${formatDate(profile.trialEndsAt)}`}
        </p>
        {profile.subscriptionStatus === 'pending_payment' && (
          <p className="status-box">בחרת מסלול. צוות WorkAway יחזור אליך להסדרת התשלום, והחשבון יופעל עם האישור.</p>
        )}
        <div className="plans">
          {plans.map((plan) => (
            <button
              type="button"
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`plan ${selectedPlan === plan.id ? 'selected' : ''}`}
            >
              <strong>
                {plan.name}
                {plan.dbId === profile.activePlanId ? ' (המסלול שלך)' : ''}
              </strong>
              <span>{plan.monthlyPrice} ש"ח לחודש</span>
              <small>עד {plan.openingsLimit} משרות פעילות</small>
              {plan.features.map((feature) => (
                <small key={feature}>· {feature}</small>
              ))}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(
              () => api.selectPlan(selectedPlan),
              trialActive ? 'המסלול נשמר ויופעל בסוף תקופת הניסיון.' : 'המסלול נבחר וממתין להסדרת תשלום.',
            )
          }
        >
          {trialActive ? 'בחירת מסלול לאחר הניסיון' : 'בחירת מסלול'}
        </button>
      </article>
    </section>
  )
}
