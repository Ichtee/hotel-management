import { useState } from 'react';
import { dateLabel, money } from './api/client.js';
import { Badge, Notice, useApi } from './ui.jsx';

const UPCOMING = ['pending', 'confirmed', 'checked_in'];
const nightsOf = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));
const part = (d, opt) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', ...opt }).format(new Date(d));
const roomNames = (b) => b.rooms.map((r) => r.roomTypeId?.name).filter(Boolean).join(', ') || 'Room';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const Skeleton = () => <div className="stack" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="skel-card" />)}</div>;
const Empty = ({ title, text, href, cta }) => (
  <div className="empty">
    <h2>{title}</h2>
    <p className="muted">{text}</p>
    {href && <a className="btn primary" href={href}>{cta}</a>}
  </div>
);
const Failed = ({ s }) => <div className="empty"><Notice error={s.error} /><button className="btn" onClick={s.reload}>Try again</button></div>;
const Row = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;

// UC11: stay, charges, payments and refund status of one booking.
function Details({ id }) {
  const s = useApi(`/bookings/${id}`);
  if (s.loading) return <div className="panel" id={`details-${id}`} aria-busy="true"><p className="muted">Loading details…</p></div>;
  if (s.error) return <div className="panel" id={`details-${id}`}><Failed s={s} /></div>;
  const b = s.data;
  const due = Math.max(0, b.totalAmount - b.paidAmount);
  return (
    <div className="panel details" id={`details-${id}`}>
      <section>
        <h3>Stay</h3>
        <dl>
          <Row k="Check-in">{dateLabel(b.checkInDate)}</Row>
          <Row k="Check-out">{dateLabel(b.checkOutDate)}</Row>
          <Row k="Nights">{nightsOf(b.checkInDate, b.checkOutDate)}</Row>
          {b.rooms.map((r, i) => (
            <Row k={r.roomTypeId?.name || 'Room'} key={i}>
              {r.roomId ? `Room ${r.roomId.roomNumber}` : 'Room assigned at check-in'} · {money(r.priceAtBooking)} / night
            </Row>
          ))}
        </dl>
      </section>
      <section>
        <h3>Charges</h3>
        <dl>
          <Row k="Rooms">{money(b.roomAmount)}</Row>
          {b.serviceAmount > 0 && <Row k="Services">{money(b.serviceAmount)}</Row>}
          {b.discountAmount > 0 && <Row k="Discount">−{money(b.discountAmount)}</Row>}
          <Row k="Total"><strong>{money(b.totalAmount)}</strong></Row>
        </dl>
      </section>
      <section>
        <h3>Payment <Badge v={b.paymentStatus} /></h3>
        <dl>
          <Row k="Deposit required">{money(b.depositRequired)}</Row>
          <Row k="Paid">{money(b.paidAmount)}</Row>
          <Row k="Balance due">{money(due)}</Row>
        </dl>
        {b.payments.length > 0 && (
          <ul className="lines" aria-label="Payments">
            {b.payments.map((p, i) => (
              <li key={i}><span>{p.kind} · {p.method.replace('_', ' ')} · {dateLabel(p.paidAt || p.createdAt)}</span><span>{money(p.amount)} <Badge v={p.status} /></span></li>
            ))}
          </ul>
        )}
      </section>
      {(b.refunds.length > 0 || b.status === 'cancelled') && (
        <section>
          <h3>Refund</h3>
          {b.refunds.length ? (
            <ul className="lines" aria-label="Refunds">
              {b.refunds.map((r, i) => <li key={i}><span>{r.reason || 'Refund'}</span><span>{money(r.amount)} <Badge v={r.status} /></span></li>)}
            </ul>
          ) : <p className="muted">No refund recorded for this cancellation.</p>}
        </section>
      )}
    </div>
  );
}

// UC10: a customer's own bookings, split into upcoming and past.
export function MyBookings() {
  const [tab, setTab] = useState('upcoming');
  const [open, setOpen] = useState(null);
  const s = useApi('/bookings?limit=100');
  const all = s.data || [];
  const isUp = (b) => UPCOMING.includes(b.status);
  const counts = { upcoming: all.filter(isUp).length, past: all.filter((b) => !isUp(b)).length };
  const list = all.filter((b) => isUp(b) === (tab === 'upcoming'));
  return (
    <div className="c-wrap c-section">
      <h1 className="title">My bookings</h1>
      <div className="chips" role="group" aria-label="Filter bookings">
        {['upcoming', 'past'].map((t) => (
          <button key={t} className={tab === t ? 'chip on' : 'chip'} aria-pressed={tab === t} onClick={() => { setTab(t); setOpen(null); }}>
            {t}{!s.loading && !s.error ? ` (${counts[t]})` : ''}
          </button>
        ))}
      </div>
      <div aria-busy={s.loading}>
        {s.loading && <Skeleton />}
        {s.error && <Failed s={s} />}
        {!s.loading && !s.error && !list.length && (
          tab === 'upcoming'
            ? <Empty title="No upcoming stays" text="Find a room and your next reservation will show up here." href="#/rooms" cta="Browse rooms" />
            : <Empty title="No past stays yet" text="Completed and cancelled bookings are kept here." />
        )}
        <div className="stack">
          {list.map((b) => {
            const n = nightsOf(b.checkInDate, b.checkOutDate);
            return (
              <div className="stack" key={b._id}>
                <article className="trip">
                  <div className="datetile" aria-hidden="true"><b>{part(b.checkInDate, { day: '2-digit' })}</b><span>{part(b.checkInDate, { month: 'short' })}</span></div>
                  <div>
                    <h3>{roomNames(b)}</h3>
                    <p className="muted">{b.bookingReference || b._id.slice(-8).toUpperCase()} · {dateLabel(b.checkInDate)} – {dateLabel(b.checkOutDate)} · {plural(n, 'night')}</p>
                    <p className="badges"><Badge v={b.status} /><Badge v={b.paymentStatus} pre="Payment: " /></p>
                  </div>
                  <div className="end">
                    <strong>{money(b.totalAmount)}</strong>
                    <button className="btn" aria-expanded={open === b._id} aria-controls={`details-${b._id}`} onClick={() => setOpen(open === b._id ? null : b._id)}>
                      {open === b._id ? 'Hide details' : 'View details'}
                    </button>
                    {b.status === 'confirmed' && <button className="btn">Cancel</button>}
                    {b.status === 'checked_out' && <button className="btn">Write review</button>}
                  </div>
                </article>
                {open === b._id && <Details id={b._id} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
