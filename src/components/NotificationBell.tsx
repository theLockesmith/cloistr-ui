import { useNotifications } from './NotificationProvider.js';

export function NotificationBell() {
  const state = useNotifications();
  if (!state) return null;

  const { unreadCount } = state;

  return (
    <button
      type="button"
      className="cloistr-notification-bell"
      aria-label={
        unreadCount > 0
          ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
          : 'No unread notifications'
      }
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '0.35rem',
        color: 'var(--cloistr-text-muted, #888)',
        lineHeight: 1,
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 2a5 5 0 0 0-5 5c0 4-2 5-2 5h14s-2-1-2-5a5 5 0 0 0-5-5" />
        <path d="M8.5 17a1.5 1.5 0 0 0 3 0" />
      </svg>
      {unreadCount > 0 && (
        <span
          className="cloistr-notification-badge"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '2px',
            right: '0',
            minWidth: '16px',
            height: '16px',
            borderRadius: '8px',
            background: 'var(--cloistr-accent, #a78bfa)',
            color: '#fff',
            fontSize: '10px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
