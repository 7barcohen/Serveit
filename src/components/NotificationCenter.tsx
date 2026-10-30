import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { formatDateTime } from '../lib/labels'
import type { AppNotification } from '../types'

type Props = {
  userId: number
  onOpen: (notification: AppNotification) => void
  // Called when a new notification arrives, so the screens can refresh.
  onActivity?: () => void
}

// In-app notification center (spec §6.3). Updates in real time; also polls as a
// fallback in case the realtime connection drops.
export function NotificationCenter({ userId, onOpen, onActivity }: Props) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [updatingRead, setUpdatingRead] = useState(false)
  const onActivityRef = useRef(onActivity)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    onActivityRef.current = onActivity
  }, [onActivity])

  useEffect(() => {
    if (!open) return
    const closeOnPointerOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnPointerOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const load = useCallback(async () => {
    try {
      setItems(await api.getNotifications())
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = api.subscribeToNotifications(userId, () => {
      void load()
      onActivityRef.current?.()
    })
    const poll = window.setInterval(() => void load(), 60000)
    return () => {
      unsubscribe()
      window.clearInterval(poll)
    }
  }, [userId, load])

  const unread = items.filter((item) => !item.readAt)

  const markAllRead = async () => {
    setUpdatingRead(true)
    try {
      await api.markNotificationsRead(null)
      await load()
    } catch {
      setLoadError(true)
    } finally {
      setUpdatingRead(false)
    }
  }

  const openItem = async (item: AppNotification) => {
    setOpen(false)
    if (!item.readAt) {
      try {
        await api.markNotificationsRead([item.id])
        void load()
      } catch {
        setLoadError(true)
      }
    }
    onOpen(item)
  }

  return (
    <div className="notifications" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="ghost bell"
        aria-label={`התראות, ${unread.length} חדשות`}
        aria-expanded={open}
        aria-controls="notifications-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {unread.length > 0 && <span className="badge-count">{unread.length}</span>}
      </button>
      {open && (
        <div className="notifications-panel card" id="notifications-panel" role="dialog" aria-label="התראות">
          <div className="calendar-head">
            <strong>התראות</strong>
            <button type="button" className="ghost" onClick={() => void markAllRead()} disabled={unread.length === 0 || updatingRead}>
              {updatingRead ? 'מעדכן/ת…' : 'סימון הכול כנקרא'}
            </button>
          </div>
          {loadError && <p className="error-text" role="alert" aria-live="assertive">לא ניתן לעדכן את ההתראות כרגע. אפשר לנסות שוב.</p>}
          {!loadError && items.length === 0 && <p className="empty">אין התראות עדיין.</p>}
          <div className="list notifications-list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`list-item notification-item ${item.readAt ? '' : 'unread'}`}
                aria-label={`${item.readAt ? '' : 'חדש: '}${item.title}${item.body ? `. ${item.body}` : ''}. ${formatDateTime(item.createdAt)}`}
                onClick={() => void openItem(item)}
              >
                <strong>{item.title}</strong>
                {item.body && <span>{item.body}</span>}
                <small>{formatDateTime(item.createdAt)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
