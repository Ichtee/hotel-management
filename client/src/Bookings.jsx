import { useState } from 'react';
import { api, dateLabel, money } from './api/client.js';
import { Badge, Notice, useApi } from './ui.jsx';

const UPCOMING = ['pending', 'confirmed', 'checked_in'];

// UC11: room, dates, amounts, and booking / payment / refund status.
function Details({ id }) {
  const s = useApi(`/bookings/${id}`);
  if (s.loading) return <p className="muted">Loading…</p>;
  if (s.error) return <Notice error={s.error} />;
  const b = s.data;
  return (
    <div className="panel stack">
      <p>Stay: {dateLabel(b.checkInDate)} → {dateLabel(b.checkOutDate)}</p>
      <ul>{b.rooms.map((r, i) => <li key={i}>{r.roomTypeId?.name}{r.roomId ? ` · room ${r.roomId.roomNumber}` : ''} · {money(r.priceAtBooking)} / night</li>)}</ul>
      <p>Rooms {money(b.roomAmount)} · Services {money(b.serviceAmount)} · Discount −{money(b.discountAmount)} · <strong>Total {money(b.totalAmount)}</strong></p>
      <p>Deposit required {money(b.depositRequired)} · Paid {money(b.paidAmount)} <Badge v={b.paymentStatus} /></p>
      {b.payments.length > 0 && <ul>{b.payments.map((p, i) => <li key={i}>{p.kind} payment · {money(p.amount)} · {p.method.replace('_', ' ')} <Badge v={p.status} /></li>)}</ul>}
      {b.refunds.map((r, i) => <p key={i}>Refund {money(r.amount)} <Badge v={r.status} /></p>)}
      {b.status === 'cancelled' && !b.refunds.length && <p className="muted">No refund recorded yet.</p>}
    </div>
  );
}

// UC10: a customer's own bookings.
export function MyBookings() {
  const [tab, setTab] = useState('upcoming');
  const [open, setOpen] = useState(null);
  const s = useApi('/bookings?limit=100');
  const list = (s.data || []).filter((b) => UPCOMING.includes(b.status) === (tab === 'upcoming'));
  return (
    <div className="c-wrap c-section">
      <h1 className="title">My bookings</h1>
      <div className="chips" role="group" aria-label="Filter">
        {['upcoming', 'past'].map((t) => <button key={t} className={tab === t ? 'chip on' : 'chip'} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {s.loading && <p className="muted">Loading…</p>}
      <Notice error={s.error} />
      <div className="stack">
        {list.map((b) => (
          <div className="stack" key={b._id}>
            <article className="trip">
              {b.rooms[0]?.roomTypeId?.images?.[0] ? <img src={b.rooms[0].roomTypeId.images[0]} alt="" /> : <span />}
              <div>
                <h3>{b.rooms.map((r) => r.roomTypeId?.name).filter(Boolean).join(', ') || 'Room'}</h3>
                <p className="muted">{b.bookingReference || b._id.slice(-8).toUpperCase()} · {dateLabel(b.checkInDate)} – {dateLabel(b.checkOutDate)}</p>
                <Badge v={b.status} /> <Badge v={b.paymentStatus} />
              </div>
              <div className="end"><strong>{money(b.totalAmount)}</strong>
                <button className="btn" aria-expanded={open === b._id} onClick={() => setOpen(open === b._id ? null : b._id)}>{open === b._id ? 'Hide details' : 'Details'}</button>
              </div>
            </article>
            {open === b._id && <Details id={b._id} />}
          </div>
        ))}
        {!s.loading && !s.error && !list.length && <p className="muted">Nothing here yet.</p>}
      </div>
    </div>
  );
}

// UC15: booking, payment and refund notifications; opening one marks it read.
export function Notifications() {
  const s = useApi('/notifications?limit=50');
  const read = async (n) => {
    if (n.isRead) return;
    await api(`/notifications/${n._id}/read`, { method: 'PATCH' }).catch(() => {});
    s.reload();
  };
  return (
    <div className="c-wrap c-section">
      <h1 className="title">Notifications{s.meta?.unread ? ` (${s.meta.unread} new)` : ''}</h1>
      {s.loading && <p className="muted">Loading…</p>}
      <Notice error={s.error} />
      <div className="stack">
        {(s.data || []).map((n) => (
          <button key={n._id} className="panel" style={{ textAlign: 'left' }} onClick={() => read(n)}>
            {n.isRead ? n.title : <strong>{n.title} · new</strong>}
            <p className="muted">{n.message} · {dateLabel(n.createdAt)}</p>
          </button>
        ))}
        {!s.loading && !s.error && !s.data?.length && <p className="muted">No notifications.</p>}
      </div>
    </div>
  );
}
