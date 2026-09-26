import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { formatDateTime, formatPay, formatTimeLeft, stageLabels } from '../lib/labels'
import { errorMessage, useNow } from '../lib/useNow'
import type { Application, ChatMessage } from '../types'
import { OfferForm } from './OfferForm'
import { ShiftLinks } from './ShiftLinks'

type Props = {
  role: 'worker' | 'employer'
  meId: number
  applications: Application[]
  selectedId: number | null
  onSelect: (applicationId: number) => void
  onChanged: () => void
}

const openChatStages = new Set(['matched', 'offered', 'hired', 'waitlisted', 'completed'])

const reportReasons = ['ניסיון להעביר פרטי קשר', 'הטרדה או תוכן פוגעני', 'הונאה או הצעה חשודה', 'אחר']

function AudioMessage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    api.getAudioUrl(path).then(
      (signed) => active && setUrl(signed),
      () => active && setFailed(true),
    )
    return () => {
      active = false
    }
  }, [path])
  if (failed) return <span>הודעה קולית אינה זמינה</span>
  return url ? <audio controls src={url} preload="none" /> : <span>טוען הודעה קולית...</span>
}

// Protected in-app chat (spec §3.1): opens on a match, masks contact details
// on the server, supports voice messages, formal offers, reporting and blocking.
export function ChatPanel({ role, meId, applications, selectedId, onSelect, onChanged }: Props) {
  const threads = applications.filter((application) => application.matchedAt)
  const active = threads.find((thread) => thread.id === selectedId) ?? threads[0] ?? null
  const now = useNow(15000)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showOfferForm, setShowOfferForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [safetyMode, setSafetyMode] = useState<'none' | 'report' | 'block'>('none')
  const [report, setReport] = useState({ reason: reportReasons[0], details: '' })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const activeId = active?.id ?? null

  useEffect(() => {
    if (activeId === null) {
      return
    }
    let alive = true
    setLoadingMessages(true)
    setShowOfferForm(false)
    setSafetyMode('none')
    api.getMessages(activeId).then(
      (loaded) => alive && setMessages(loaded),
      () => alive && setError('טעינת ההודעות נכשלה.'),
    ).finally(() => alive && setLoadingMessages(false))
    const unsubscribe = api.subscribeToMessages(activeId, (message) => {
      setMessages((previous) => (previous.some((item) => item.id === message.id) ? previous : [...previous, message]))
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [activeId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  if (threads.length === 0) {
    return (
      <article className="card">
        <h2>צ׳אט</h2>
        <p className="empty">
          {role === 'worker'
            ? 'הצ׳אט נפתח אחרי Match: כשגם המעסיק סימן אותך כמתאים/ה.'
            : 'הצ׳אט נפתח אחרי Match: כשגם המועמד/ת סימן/ה עניין במשרה.'}
        </p>
      </article>
    )
  }

  const chatOpen = active ? openChatStages.has(active.stage) : false
  const counterpartName = active ? (role === 'worker' ? active.employer.name : active.worker.firstName) : ''
  const counterpartId = active ? (role === 'worker' ? active.employerId : active.workerId) : 0
  const offer = active?.offer ?? null

  const appendMessage = (message: ChatMessage) =>
    setMessages((previous) => (previous.some((item) => item.id === message.id) ? previous : [...previous, message]))

  const send = async () => {
    if (!active || !draft.trim()) return
    setError('')
    try {
      const message = await api.sendMessage(active.id, draft.trim())
      appendMessage(message)
      setDraft('')
      setNotice(message.wasFiltered ? 'פרטי קשר הוסתרו מההודעה. העברת פרטי קשר מחוץ לפלטפורמה אסורה.' : '')
    } catch (caught) {
      setError(errorMessage(caught, 'שליחת ההודעה נכשלה.'))
    }
  }

  const toggleRecording = async () => {
    if (!active) return
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => chunks.push(event.data)
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        setRecording(false)
        const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (audio.size === 0) return
        try {
          const path = await api.uploadVoiceMessage(active.id, audio)
          appendMessage(await api.sendMessage(active.id, null, path))
        } catch (caught) {
          setError(errorMessage(caught, 'שליחת ההודעה הקולית נכשלה.'))
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      setError('אין גישה למיקרופון. יש לאשר הרשאת מיקרופון בדפדפן.')
    }
  }

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setNotice(success)
      onChanged()
      if (active) setMessages(await api.getMessages(active.id))
    } catch (caught) {
      setError(errorMessage(caught, 'הפעולה נכשלה.'))
    } finally {
      setBusy(false)
    }
  }

  const submitReport = () =>
    runAction(
      () => api.reportUser({ reportedId: counterpartId, reason: report.reason, details: report.details, applicationId: active?.id }),
      'הדיווח נשלח לצוות WorkAway. תודה.',
    ).then(() => setSafetyMode('none'))

  const confirmBlock = () =>
    runAction(() => api.blockUser(counterpartId), 'המשתמש נחסם. לא תראו זה את זה בפיד ולא תוכלו לשלוח הודעות.').then(() =>
      setSafetyMode('none'),
    )

  return (
    <section className="panel chat-layout">
      <article className="card chat-threads">
        <h2>שיחות</h2>
        <div className="list">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`list-item thread-item ${thread.id === active?.id ? 'selected' : ''}`}
              onClick={() => onSelect(thread.id)}
            >
              <strong>{role === 'worker' ? thread.employer.name : thread.worker.firstName}</strong>
              <span>{thread.job.title}</span>
              <small>{stageLabels[thread.stage]}</small>
            </button>
          ))}
        </div>
      </article>

      {active && (
        <article className="card chat-box-card">
          <div className="chat-header">
            <strong>
              {counterpartName} · {active.job.title}
            </strong>
            <small>
              {stageLabels[active.stage]}
              {role === 'employer' && ` · מדד אמינות ${active.worker.reliabilityScore}`}
            </small>
            <div className="fit-actions">
              <button type="button" className="ghost" onClick={() => setSafetyMode(safetyMode === 'report' ? 'none' : 'report')}>
                דיווח
              </button>
              <button type="button" className="ghost" onClick={() => setSafetyMode(safetyMode === 'block' ? 'none' : 'block')}>
                חסימה
              </button>
            </div>
          </div>

          {safetyMode === 'report' && (
            <div className="status-box">
              <label>
                סיבת הדיווח
                <select value={report.reason} onChange={(event) => setReport({ ...report, reason: event.target.value })}>
                  {reportReasons.map((reason) => (
                    <option key={reason}>{reason}</option>
                  ))}
                </select>
              </label>
              <label>
                פרטים
                <input value={report.details} onChange={(event) => setReport({ ...report, details: event.target.value })} />
              </label>
              <button type="button" className="primary" onClick={() => void submitReport()} disabled={busy}>
                שליחת דיווח
              </button>
            </div>
          )}
          {safetyMode === 'block' && (
            <div className="status-box">
              <p>לחסום את {counterpartName}? תהליכים פתוחים ביניכם ייסגרו ולא תוכלו לשלוח הודעות.</p>
              <button type="button" className="primary" onClick={() => void confirmBlock()} disabled={busy}>
                כן, לחסום
              </button>
            </div>
          )}

          {offer && offer.status === 'pending' && (
            <div className="status-box offer-card">
              <strong>{offer.fromWaitlist ? 'תקן התפנה! הצעה מרשימת ההמתנה' : 'הצעת עבודה רשמית'}</strong>
              <span>
                {formatDateTime(offer.startsAt)}–{formatDateTime(offer.endsAt).split(' ').pop()} · {offer.address}
              </span>
              <span>{formatPay(offer.payType, offer.payAmount)}</span>
              {offer.conditions && <span>תנאים: {offer.conditions}</span>}
              <span className="countdown">{formatTimeLeft(offer.expiresAt, now)}</span>
              {role === 'worker' ? (
                <div className="fit-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        const stage = await api.respondJobOffer(offer.id, true)
                        if (stage === 'waitlisted') {
                          throw new Error('המשרה התמלאה ברגע האחרון. נכנסת לרשימת ההמתנה.')
                        }
                      }, 'ההצעה אושרה! נשלח אליך קישור לטופס 101.')
                    }
                  >
                    אישור ההצעה
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => void runAction(() => api.respondJobOffer(offer.id, false), 'ההצעה נדחתה.')}
                  >
                    דחייה
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void runAction(() => api.cancelJobOffer(offer.id), 'ההצעה בוטלה.')}
                >
                  ביטול ההצעה
                </button>
              )}
            </div>
          )}

          {active.stage === 'hired' && offer?.status === 'accepted' && (
            <div className="status-box">
              <strong>משמרת מאושרת: {formatDateTime(offer.startsAt)}</strong>
              <span>{offer.address}</span>
              {role === 'worker' && <ShiftLinks application={active} />}
            </div>
          )}

          {role === 'employer' && active.stage === 'matched' && !showOfferForm && (
            <button type="button" className="primary" onClick={() => setShowOfferForm(true)}>
              שלח הצעת עבודה
            </button>
          )}
          {role === 'employer' && showOfferForm && (
            <OfferForm
              application={active}
              onCancel={() => setShowOfferForm(false)}
              onSent={() => {
                setShowOfferForm(false)
                setNotice('ההצעה נשלחה.')
                onChanged()
                void api.getMessages(active.id).then(setMessages)
              }}
            />
          )}

          <div className="chat-messages" aria-live="polite">
            {loadingMessages && <p className="empty">טוען הודעות...</p>}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`chat-message ${message.senderId === null ? 'system' : message.senderId === meId ? 'mine' : 'theirs'}`}
              >
                {message.body && <span className="message-text">{message.body}</span>}
                {message.audioPath && <AudioMessage path={message.audioPath} />}
                <small>
                  {formatDateTime(message.createdAt)}
                  {message.wasFiltered && ' · פרטי קשר הוסתרו'}
                </small>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {notice && <p className="status-box">{notice}</p>}
          {error && <p className="error-text">{error}</p>}

          {chatOpen ? (
            <div className="chat-input-row with-voice">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={role === 'worker' ? 'כתבו למעסיק...' : 'כתבו למועמד/ת...'}
                maxLength={2000}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <button
                type="button"
                className={recording ? 'primary recording' : 'ghost'}
                onClick={() => void toggleRecording()}
                aria-label={recording ? 'עצירת הקלטה ושליחה' : 'הקלטת הודעה קולית'}
              >
                {recording ? '⏹ שליחה' : '🎤'}
              </button>
              <button type="button" className="primary" onClick={() => void send()} disabled={!draft.trim()}>
                שלח
              </button>
            </div>
          ) : (
            <p className="empty">השיחה סגורה ({stageLabels[active.stage]}).</p>
          )}
        </article>
      )}
    </section>
  )
}
