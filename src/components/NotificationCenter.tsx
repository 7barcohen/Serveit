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
  const onActivityRef = useRef(onActivity)

  useEffect(() => {
    onActivityRef.current = onActivity
  }, [onActivity])

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
    await api.markNotificationsRead(null)
    await load()
  }

  const openItem = async (item: AppNotification) => {
    setOpen(false)
    if (!item.readAt) {
      await api.markNotificationsRead([item.id])
      void load()
    }
    onOpen(item)
  }

  return (
    <div className="notifications">
      <button
        type="button"
        className="ghost bell"
        aria-label={`התראות, ${unread.length} חדשות`}
        onClick={() => setOpen((value) => !value)}
      >
        🔔 {unread.length > 0 && <span className="badge-count">{unread.length}</span>}
      </button>
      {open && (
        <div className="notifications-panel card" role="dialog" aria-label="התראות">
          <div className="calendar-head">
            <strong>התראות</strong>
            <button type="button" className="ghost" onClick={() => void markAllRead()} disabled={unread.length === 0}>
              סימון הכל כנקרא
            </button>
          </div>
          {loadError && <p className="error-text">טעינת ההתראות נכשלה.</p>}
          {!loadError && items.length === 0 && <p className="empty">אין התראות עדיין.</p>}
          <div className="list notifications-list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`list-item notification-item ${item.readAt ? '' : 'unread'}`}
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
