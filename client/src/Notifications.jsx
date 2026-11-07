import { useEffect, useRef, useState } from 'react';
import { api } from './api/client.js';
import { useApi } from './ui.jsx';

const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/* UC13: the signed-in user's notifications (BR-28). Opening one marks it read. */
export default function NotificationBell({ bookingHref }) {
  const list = useApi('/notifications');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { reload } = list;
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false); };
    addEventListener('click', close); addEventListener('keydown', close);
    return () => { removeEventListener('click', close); removeEventListener('keydown', close); };
  }, []);
  const unread = list.meta?.unread || 0;
  const read = async (body) => { try { await api('/notifications/read', { method: 'POST', body }); reload(); } catch { /* the list simply stays unread */ } };
  const openOne = (n) => { if (!n.isRead) read({ id: n._id }); if (n.bookingId && bookingHref) { location.hash = bookingHref; setOpen(false); } };
  return (
    <div className="bell" ref={ref}>
      <button type="button" className="bell-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) reload(); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Notifications">
          <div className="bell-head"><b>Notifications</b>{unread > 0 && <button type="button" className="linklike" onClick={() => read({})}>Mark all as read</button>}</div>
          {list.error ? <p className="bell-empty">Could not load notifications.</p>
            : !list.data?.length ? <p className="bell-empty">You have no notifications.</p>
            : (
              <ul>
                {list.data.map((n) => (
                  <li key={n._id} className={n.isRead ? '' : 'unread'}>
                    <button type="button" onClick={() => openOne(n)}>
                      <b>{n.title}</b><span>{n.message}</span><small>{ago(n.createdAt)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
