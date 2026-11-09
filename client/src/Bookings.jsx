import { useState } from 'react';
import StayInvoices from './StayInvoices.jsx';
import { api, dateLabel, inputDate, money } from './api/client.js';
import { Badge, DataTable, Field, Modal, Notice, useApi } from './ui.jsx';

const UPCOMING = ['pending', 'confirmed', 'checked_in', 'cancellation_requested'];
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
          {b.nightlyRates?.length ? b.nightlyRates.map((n) => <Row key={n.date} k={`Night of ${dateLabel(n.date)}`}>{money(n.price)}</Row>) : <Row k="Rooms">{money(b.roomAmount)}</Row>}
          {(b.feeLines || []).map((f, i) => <Row key={i} k={{ early_check_in: 'Early check-in fee', late_check_out: 'Late check-out fee', extra_night: 'Extra night (after 18:00)' }[f.type]}>{money(f.amount)}</Row>)}
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
          <button className="btn" onClick={() => act(`/bookings/${id}/withdraw-cancellation`, 'POST', 'Withdraw the cancellation request and keep this booking?')}>Withdraw request</button>
        </section>
      )}
      {b.requests?.length > 0 && (
        <section>
          <h3>Check-in / check-out requests</h3>
          <ul className="lines" aria-label="Requests">
            {b.requests.map((r) => (
              <li key={r._id}>
                <span>{r.type === 'check_in' ? 'Check-in' : 'Check-out'} at {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(r.requestedTime))}{r.earlyOrLate ? ` · ${r.type === 'check_in' ? 'early check-in' : 'late check-out'}${r.quotedFee ? ` (fee ${money(r.quotedFee)} if it takes place)` : ''}` : ''}{r.responseNote ? ` · ${r.responseNote}` : ''}</span>
                <span><Badge v={r.status} />{['pending', 'approved'].includes(r.status) && <button className="btn sm" onClick={() => act(`/bookings/${id}/requests/${r._id}`, 'DELETE', 'Withdraw this request?')}>Withdraw</button>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {b.penalties?.length > 0 && (
        <section>
          <h3>Damage / loss charges</h3>
          <ul className="lines" aria-label="Penalties">
            {b.penalties.map((p) => (
              <li key={p._id}><span>{p.description || p.itemName}{p.status === 'waived' && p.reason ? ` · waived: ${p.reason}` : ''}</span><span>{money(p.amount || 0)} <Badge v={p.status} /></span></li>
            ))}
          </ul>
        </section>
      )}
      {b.invoices?.length > 0 && (
        <section>
          <h3>Invoices</h3>
          <ul className="lines" aria-label="Invoices">
            {b.invoices.map((inv) => (
              <li key={inv._id}><span>{inv.invoiceNumber}{inv.type === 'supplementary' ? ` · supplementary (${(inv.lines || []).map((l) => l.description).join(', ')})` : ''} · {dateLabel(inv.issuedAt || inv.createdAt)}</span><span>{money(inv.totalAmount)}</span></li>
            ))}
          </ul>
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

// UC07: the stay dates, the number of guests and the contact data; the room type stays the same (cancel and book again).
function ModifyModal({ booking, onClose, onSaved }) {
  const [inDate, setInDate] = useState(inputDate(booking.checkInDate));
  const [outDate, setOutDate] = useState(inputDate(booking.checkOutDate));
  const [guests, setGuests] = useState(booking.rooms?.[0]?.guestCount || 1);
  const [name, setName] = useState(booking.guestName || '');
  const [phone, setPhone] = useState(booking.guestPhone || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const nights = inDate && outDate ? nightsOf(inDate, outDate) : 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!inDate || !outDate) return;
    if (new Date(outDate) <= new Date(inDate)) {
      setErr(new Error('Check-out date must be strictly after check-in date'));
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api(`/bookings/${booking._id}/modify`, {
        method: 'POST',
        body: {
          checkInDate: inDate,
          checkOutDate: outDate,
          guestCount: Number(guests),
          ...(name.trim() ? { fullName: name.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }
      });
      onSaved(`Reservation ${booking.bookingReference || ''} updated successfully.`);
    } catch (x) {
      setErr(x);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Modify reservation ${booking.bookingReference || ''}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted full">
          Availability and price are recalculated. The deposit already paid does not change: any difference is paid at check-out.
          Dates can be changed only while a cancellation would still be refunded in full.
        </p>
        <Field label="Check-in date">
          <input
            type="date"
            value={inDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setInDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Check-out date">
          <input
            type="date"
            value={outDate}
            min={inDate || new Date().toISOString().slice(0, 10)}
            onChange={(e) => setOutDate(e.target.value)}
            required
          />
        </Field>
        <div className="full">
          <p className="preview" style={{ margin: '0.5rem 0' }}>
            Duration: <strong>{nights} night{nights === 1 ? '' : 's'}</strong>
          </p>
        </div>
        <Field label="Guests"><input type="number" min="1" max="10" value={guests} onChange={(e) => setGuests(e.target.value)} required /></Field>
        <Field label="Guest full name"><input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} /></Field>
        <Field label="Phone"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} pattern="([0-9]{10,11}|\+[0-9]{8,15})" /></Field>
        <div className="full">
          <Notice error={err} />
        </div>
        <div className="full modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving || nights <= 0}>
            {saving ? 'Updating…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Modal for confirming cancellation
function CancelModal({ booking, onClose, onCancelled }) {
  const isPending = booking.status === 'pending';
  const [reason, setReason] = useState('Change of travel plans');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      if (isPending) {
        // BR-29: Abandon payment and release 15-min hold immediately
        await api(`/bookings/${booking._id}/cancel-payment`, {
          method: 'POST'
        });
        onCancelled(`Reservation hold for ${booking.bookingReference || ''} has been cancelled and room released.`);
      } else {
        // UC08 / BR-16, BR-17, BR-32: Cancellation with tiered refund policy
        await api(`/bookings/${booking._id}/cancel`, {
          method: 'POST',
          body: { reason }
        });
        onCancelled(`Cancellation request for ${booking.bookingReference || ''} has been submitted for front desk review.`);
      }
    } catch (x) {
      setErr(x);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isPending ? `Cancel hold: ${booking.bookingReference || ''}` : `Cancel reservation ${booking.bookingReference || ''}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          {isPending
            ? 'This reservation is currently pending deposit payment. Cancelling now will release your 15-minute room hold immediately.'
            : 'The refund follows the hotel cancellation policy. If a deposit was paid, the front desk will contact you for your bank account to transfer the refund.'}
        </p>

        <Field label="Reason for cancellation">
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="Change of travel plans">Change of travel plans</option>
            <option value="Found alternative accommodation">Found alternative accommodation</option>
            <option value="Unable to travel on chosen dates">Unable to travel on chosen dates</option>
            <option value="Other reason">Other reason</option>
          </select>
        </Field>

        <div className="full">
          <Notice error={err} />
        </div>
        <div className="full modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Keep reservation</button>
          <button type="submit" className="btn" style={{ background: '#b91c1c', color: '#fff', borderColor: '#b91c1c' }} disabled={saving}>
            {saving ? 'Processing…' : (isPending ? 'Abandon payment & release hold' : 'Submit cancellation request')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Modal for submitting a review (UC12, BR-23)
function ReviewModal({ booking, onClose, onSaved }) {
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const roomName = booking.rooms?.[0]?.roomTypeId?.name || 'Room';

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await api('/reviews', {
        method: 'POST',
        body: {
          bookingId: booking._id,
          rating: Number(rating),
          title: title.trim(),
          comment: comment.trim()
        }
      });
      onSaved('Thank you! Your review has been submitted successfully.');
    } catch (x) {
      setErr(x);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Review your stay (${booking.bookingReference || ''})`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Share your experience for <strong>{roomName}</strong> from {dateLabel(booking.checkInDate)} to {dateLabel(booking.checkOutDate)}.
        </p>

        <Field label="Rating">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className="btn sm"
                style={{
                  fontSize: '1.25rem',
                  padding: '4px 10px',
                  background: star <= rating ? '#fbbf24' : '#e5e7eb',
                  color: star <= rating ? '#78350f' : '#6b7280',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
                onClick={() => setRating(star)}
              >
                ★ {star}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Title (optional)">
          <input
            type="text"
            placeholder="e.g. Wonderful stay and friendly staff!"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
        </Field>

        <Field label="Comment">
          <textarea
            rows="4"
            placeholder="Tell us what you liked and how we can improve..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            required
          />
        </Field>

        <div className="full">
          <Notice error={err} />
        </div>

        <div className="full modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// UC39: before arriving, a check-in request with the pre-registration data; during the stay, a check-out request.
// A request without early check-in / late check-out is approved at once (BR-44).
function StayRequestModal({ booking, type, onClose, onSaved }) {
  const isIn = type === 'check_in';
  const day = inputDate(isIn ? booking.checkInDate : booking.checkOutDate);
  const [err, setErr] = useState(null); const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); setSaving(true); setErr(null);
    try {
      const body = { type, requestedTime: `${day}T${f.time}:00+07:00`, note: f.note || '', ...(isIn ? { numberOfGuests: Number(f.numberOfGuests), mainGuestName: f.mainGuestName, mainGuestIdNumber: f.mainGuestIdNumber } : {}) };
      const r = await api(`/bookings/${booking._id}/requests`, { method: 'POST', body });
      onSaved(r.data.status === 'approved' ? `${r.message} No early check-in / late check-out was asked, so it is approved.` : r.message);
    } catch (x) { setErr(x); setSaving(false); }
  };
  return (
    <Modal title={`${isIn ? 'Check-in' : 'Check-out'} request · ${booking.bookingReference || ''}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted full">{isIn ? 'Tell the front desk when you arrive so the room is ready. Check-in is from 14:00; an earlier time is an early check-in request.' : 'Tell the front desk when you leave so the bill is ready. Check-out is until 12:00; a later time (until 18:00) is a late check-out request.'} A fee applies only if it really takes place.</p>
        <Field label={`${isIn ? 'Expected arrival' : 'Planned check-out'} time on ${dateLabel(day)}`}><input name="time" type="time" defaultValue={isIn ? '14:00' : '12:00'} required /></Field>
        {isIn && <>
          <Field label="Number of guests"><input name="numberOfGuests" type="number" min="1" max="10" defaultValue={booking.rooms?.[0]?.guestCount || 1} required /></Field>
          <Field label="Main guest full name"><input name="mainGuestName" defaultValue={booking.guestName || ''} minLength={2} maxLength={80} required /></Field>
          <Field label="Main guest ID / passport number"><input name="mainGuestIdNumber" minLength={3} maxLength={40} required /></Field>
        </>}
        <Field label="Note (optional)"><input name="note" maxLength={1000} /></Field>
        <div className="full"><Notice error={err} /></div>
        <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Sending…' : 'Send request'}</button></div>
      </form>
    </Modal>
  );
}

// UC10: a customer's own bookings, split into upcoming and past.
export function MyBookings() {
  const [tab, setTab] = useState('upcoming');
  const [open, setOpen] = useState(null);
  const [modifying, setModifying] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [notice, setNotice] = useState(null);
  const [msg, setMsg] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const s = useApi('/bookings?limit=100');
  const changed = (m) => { setMsg(m); setOpen(null); s.reload(); };
  const [requesting, setRequesting] = useState(null); // { booking, type }
  const viewInvoice = async (booking) => { try { setInvoice((await api(`/bookings/${booking._id}/invoice`)).data); } catch (error) { setMsg(error.message); } };
  const all = s.data || [];
  const isUp = (b) => UPCOMING.includes(b.status);
  const counts = { upcoming: all.filter(isUp).length, past: all.filter((b) => !isUp(b)).length };
  const list = all.filter((b) => isUp(b) === (tab === 'upcoming'));

  // BR-36: Withdraw cancellation request — restore booking to confirmed
  const withdraw = async (booking) => {
    if (!window.confirm(`Are you sure you want to withdraw the cancellation request for ${booking.bookingReference}?`)) return;
    try {
      await api(`/bookings/${booking._id}/withdraw-cancellation`, { method: 'POST' });
      setNotice(`Cancellation request for ${booking.bookingReference} withdrawn. Status restored to confirmed.`);
      s.reload();
    } catch (x) {
      alert(x.message);
    }
  };

  return (
    <div className="c-wrap c-section">
      <h1 className="title">My bookings</h1>
      <Notice ok={notice} />
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
            const canModifyOrCancel = ['pending', 'confirmed'].includes(b.status);
            const isCancellationRequested = b.status === 'cancellation_requested';
            return (
              <div className="stack" key={b._id}>
                <article className="trip">
                  <div className="datetile" aria-hidden="true"><b>{part(b.checkInDate, { day: '2-digit' })}</b><span>{part(b.checkInDate, { month: 'short' })}</span></div>
                  <div>
                    <h3>{roomNames(b)}</h3>
                    <p className="muted">{b.bookingReference || b._id.slice(-8).toUpperCase()} · {dateLabel(b.checkInDate)} – {dateLabel(b.checkOutDate)} · {plural(n, 'night')}</p>
                    <p className="badges">
                      <Badge v={b.status} />
                      <Badge v={b.paymentStatus} pre="Payment: " />
                      {b.status === 'pending' && b.holdExpiresAt && (
                        <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                          15m hold
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="end">
                    <strong>{money(b.totalAmount)}</strong>
                    {depositDue(b) && <a className="btn primary" href={`#/pay/${b._id}?kind=deposit`}>Pay deposit</a>}
                    <button className="btn" aria-expanded={open === b._id} aria-controls={`details-${b._id}`} onClick={() => { setOpen(open === b._id ? null : b._id); setCancelFor(null); }}>
                      {open === b._id ? 'Hide details' : 'View details'}
                    </button>
                    {canModifyOrCancel && (
                      <>
                        <button className="btn" onClick={() => setModifying(b)}>Modify</button>
                        <button className="btn danger" onClick={() => (b.status === 'pending' ? setCancelling(b) : (setOpen(b._id), setCancelFor(b._id)))}>
                          {b.status === 'pending' ? 'Abandon hold' : 'Cancel'}
                        </button>
                      </>
                    )}
                    {isCancellationRequested && (
                      <button className="btn" onClick={() => withdraw(b)}>
                        Withdraw request
                      </button>
                    )}
                    {b.status === 'checked_out' && (
                      <button className="btn" onClick={() => setReviewing(b)}>
                        Write review
                      </button>
                    )}
                    {b.status === 'confirmed' && <button className="btn" onClick={() => setRequesting({ booking: b, type: 'check_in' })}>Check-in request</button>}
                    {b.status === 'checked_in' && <button className="btn" onClick={() => setRequesting({ booking: b, type: 'check_out' })}>Check-out request</button>}
                    {b.status === 'checked_out' && <button className="btn" onClick={() => viewInvoice(b)}>View invoice</button>}
                  </div>
                </article>
                {open === b._id && <Details key={`${b._id}-${cancelFor === b._id}`} id={b._id} startCancel={cancelFor === b._id} onChanged={changed} />}
              </div>
            );
          })}
        </div>
      </div>

      {modifying && (
        <ModifyModal
          booking={modifying}
          onClose={() => setModifying(null)}
          onSaved={(msg) => {
            setModifying(null);
            setNotice(msg);
            s.reload();
          }}
        />
      )}

      {cancelling && (
        <CancelModal
          booking={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={(msg) => {
            setCancelling(null);
            setNotice(msg);
            s.reload();
          }}
        />
      )}

      {reviewing && (
        <ReviewModal
          booking={reviewing}
          onClose={() => setReviewing(null)}
          onSaved={(msg) => {
            setReviewing(null);
            setNotice(msg);
            s.reload();
          }}
        />
      )}
      {invoice && <CustomerInvoice invoice={invoice} onClose={() => setInvoice(null)} />}
      {requesting && <StayRequestModal booking={requesting.booking} type={requesting.type} onClose={() => setRequesting(null)} onSaved={(m) => { setRequesting(null); changed(m); }} />}
    </div>
  );
}

function CustomerInvoice({ invoice, onClose }) {
  const b = invoice.bookingId;
  // BR-21: the lines copied when the invoice was issued; older invoices fall back to the booking totals.
  const rows = invoice.lines?.length
    ? [...invoice.lines.map((l) => [l.name.replace(/Night of (\d{4}-\d{2}-\d{2})/, (_, d) => `Night of ${dateLabel(d)}`), money(l.amount)]), ['Total', money(invoice.totalAmount)], ['Paid', money(invoice.paidAmount ?? invoice.totalAmount)], ['Balance', money(invoice.balance ?? 0)]]
    : [['Room charges', money(b.roomAmount)], ['Additional services', money(b.serviceAmount)], ['Total paid', money(invoice.totalAmount)]];
  return <Modal title={`Invoice ${invoice.invoiceNumber}`} onClose={onClose}>
    {invoice.hotelName && <p><b>{invoice.hotelName}</b>{invoice.hotelAddress ? ` · ${invoice.hotelAddress}` : ''}</p>}
    <p>{b.bookingReference} · {dateLabel(b.checkInDate)} - {dateLabel(b.checkOutDate)} · issued {dateLabel(invoice.issuedAt)}</p>
    <div id="invoice-print"><DataTable cols={['Item', 'Amount']} rows={rows} /></div>
    <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()}>Print</button></div>
  </Modal>;
}

