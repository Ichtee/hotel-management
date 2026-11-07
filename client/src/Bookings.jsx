import { useState } from 'react';
import StayInvoices from './StayInvoices.jsx';
import { api, dateLabel, money } from './api/client.js';
import { Badge, Notice, useApi } from './ui.jsx';

const UPCOMING = ['pending', 'confirmed', 'cancellation_requested', 'checked_in'];
const nightsOf = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));
const part = (d, opt) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', ...opt }).format(new Date(d));
const roomNames = (b) => b.rooms.map((r) => r.roomTypeId?.name).filter(Boolean).join(', ') || 'Room';
// UC12: a pending booking whose 15-minute hold is still running and whose deposit is unpaid.
const depositDue = (b) => b.status === 'pending' && b.depositRequired > 0 && b.holdExpiresAt && new Date(b.holdExpiresAt) > new Date() && !(b.paidAmount > 0);
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
const REFUND = { requested: 'Waiting for refund', completed: 'Refunded' };
// "48 h or more before check-in: 100% refund" for tiers sorted from the longest time.
const tierText = (t, i, all) =>
  `${t.minHoursBeforeCheckIn > 0 ? `${t.minHoursBeforeCheckIn} h or more before check-in` : i > 0 ? `Less than ${all[i - 1].minHoursBeforeCheckIn} h before check-in` : 'Any time'}: ${t.refundPercent ? 'full refund' : 'no refund'}`;

// UC08 steps 2-5: the estimated refund under the booking's policy, then the request.
function CancelPanel({ id, onDone }) {
  const est = useApi(`/bookings/${id}/refund-estimate`);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api(`/bookings/${id}/cancel`, { method: 'POST', body: reason.trim() ? { reason } : {} });
      onDone(r.message);
    } catch (x) { setErr(x); setBusy(false); }
  };
  if (est.loading) return <p className="muted">Calculating your refund…</p>;
  if (est.error) return <Notice error={est.error} />;
  const e = est.data;
  return (
    <section className="cancel-box" aria-labelledby={`cx-${id}`}>
      <h3 id={`cx-${id}`}>Cancel this booking</h3>
      {e.depositPaid < 1 ? <p>No deposit was paid, so the booking is cancelled at once.</p>
        : e.refundableAmount > 0 ? <p>Estimated refund: <strong>{money(e.refundableAmount)}</strong> (your deposit). The front desk reviews the request and then contacts you by phone or e-mail for the bank account.</p>
          : <p role="note">Under the policy of this booking your deposit of <strong>{money(e.depositPaid)}</strong> will not be refunded.</p>}
      {e.tiers.length > 0 && <ul className="muted tiers">{e.tiers.map((t, i, all) => <li key={i}>{tierText(t, i, all)}</li>)}</ul>}
      <label htmlFor={`cr-${id}`}>Reason (optional)</label>
      <textarea id={`cr-${id}`} rows="2" maxLength="500" value={reason} onChange={(ev) => setReason(ev.target.value)} />
      <div className="cta-row"><button className="btn danger" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Confirm cancellation'}</button></div>
      <Notice error={err} />
    </section>
  );
}

// UC11: stay, charges, payments and refund status of one booking.
function Details({ id, startCancel, onChanged }) {
  const s = useApi(`/bookings/${id}`);
  const [cancelling, setCancelling] = useState(startCancel);
  const [err, setErr] = useState(null);
  const act = async (path, method, question) => {
    if (!confirm(question)) return;
    try { onChanged((await api(path, { method })).message); } catch (x) { setErr(x); }
  };
  if (s.loading) return <div className="panel" id={`details-${id}`} aria-busy="true"><p className="muted">Loading details…</p></div>;
  if (s.error) return <div className="panel" id={`details-${id}`}><Failed s={s} /></div>;
  const b = s.data;
  const due = Math.max(0, b.totalAmount - b.paidAmount);
  const canDeposit = depositDue(b);
  // BR-14: only the deposit is paid online; the balance is settled at the front desk at check-out.
  const payAtDesk = ['confirmed', 'checked_in'].includes(b.status) && due > 0;
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
          {b.feeAmount > 0 && <Row k="Stay fees">{money(b.feeAmount)}</Row>}
          {b.penaltyAmount > 0 && <Row k="Confirmed penalties">{money(b.penaltyAmount)}</Row>}
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
        {payAtDesk && <p className="muted">The balance is paid at the front desk when you check out (cash, card or bank transfer).</p>}
        {b.payments.length > 0 && (
          <ul className="lines" aria-label="Payments">
            {b.payments.map((p, i) => (
              <li key={i}><span>{p.kind} · {p.method.replace('_', ' ')} · {dateLabel(p.paidAt || p.createdAt)}</span><span>{money(p.amount)} <Badge v={p.status} /></span></li>
            ))}
          </ul>
        )}
      </section>
      {canDeposit && (
        <div className="cta-row">
          <a className="btn primary" href={`#/pay/${id}?kind=deposit`}>Pay deposit {money(b.depositRequired)}</a><p className="muted">Room held until {part(b.holdExpiresAt, { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      )}
      {b.status === 'confirmed' && !cancelling && <div className="cta-row"><button className="btn" onClick={() => setCancelling(true)}>Cancel booking</button></div>}
      {b.status === 'confirmed' && cancelling && <CancelPanel id={id} onDone={onChanged} />}
      {b.status === 'pending' && (
        <div className="cta-row">
          <button className="btn" onClick={() => act(`/bookings/${id}/cancel-payment`, 'POST', 'Cancel the payment and release the held room?')}>Cancel payment</button>
        </div>
      )}
      {b.status === 'cancellation_requested' && (
        <section>
          <h3>Cancellation requested</h3>
          <p>Sent {dateLabel(b.cancellation.requestedAt)} · {b.cancellation.refundableAmount > 0 ? `refund of ${money(b.cancellation.refundableAmount)} once approved` : 'no refund under the policy'}.</p>
          <p className="muted">The front desk approves it within 24 hours; the room stays held until then.</p>
          <button className="btn" onClick={() => act(`/bookings/${id}/cancel`, 'DELETE', 'Withdraw the cancellation request and keep this booking?')}>Withdraw request</button>
        </section>
      )}
      <Notice error={err} />
      {b.pendingChange && new Date(b.pendingChange.holdExpiresAt) > new Date() && <p>Đề nghị đổi lịch đang chờ cọc bổ sung {money(b.pendingChange.additionalDeposit)}. Lịch hiện tại vẫn có hiệu lực; liên hệ lễ tân để theo dõi.</p>}
      {b.status === 'checked_out' && <StayInvoices bookingId={id} />}
      {(b.refunds.length > 0 || b.status === 'cancelled') && (
        <section>
          <h3>Refund</h3>
          {b.refunds.length ? (
            <ul className="lines" aria-label="Refunds">
              {b.refunds.map((r, i) => (
                <li key={i}>
                  <span>{r.status === 'completed' ? `Bank transfer ${r.bankTransactionCode} · ${dateLabel(r.processedAt)}` : 'The front desk will contact you for the bank account.'}</span>
                  <span>{money(r.amount)} <span className={`badge b-${r.status}`}>{REFUND[r.status] || r.status}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">This cancellation is not eligible for a refund.</p>}
        </section>
      )}
    </div>
  );
}

// UC10: a customer's own bookings, split into upcoming and past.
export function MyBookings() {
  const [tab, setTab] = useState('upcoming');
  const [open, setOpen] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [msg, setMsg] = useState(null);
  const s = useApi('/bookings?limit=100');
  const changed = (m) => { setMsg(m); setOpen(null); s.reload(); };
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
      <Notice ok={msg} />
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
                    {depositDue(b) && <a className="btn primary" href={`#/pay/${b._id}?kind=deposit`}>Pay deposit</a>}
                    <button className="btn" aria-expanded={open === b._id} aria-controls={`details-${b._id}`} onClick={() => { setOpen(open === b._id ? null : b._id); setCancelFor(null); }}>
                      {open === b._id ? 'Hide details' : 'View details'}
                    </button>
                    {b.status === 'confirmed' && <button className="btn" onClick={() => { setOpen(b._id); setCancelFor(b._id); setMsg(null); }}>Cancel</button>}
                    {b.status === 'checked_out' && <button className="btn">Write review</button>}
                  </div>
                </article>
                {open === b._id && <Details key={`${b._id}-${cancelFor === b._id}`} id={b._id} startCancel={cancelFor === b._id} onChanged={changed} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
