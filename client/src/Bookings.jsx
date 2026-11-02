import { useState } from 'react';
import { api, dateLabel, inputDate, money } from './api/client.js';
import { Badge, Field, Modal, Notice, useApi } from './ui.jsx';

const UPCOMING = ['pending', 'confirmed', 'checked_in', 'cancellation_requested'];
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

// Modal for modifying reservation dates & requests
function ModifyModal({ booking, onClose, onSaved }) {
  const [inDate, setInDate] = useState(inputDate(booking.checkInDate));
  const [outDate, setOutDate] = useState(inputDate(booking.checkOutDate));
  const [requests, setRequests] = useState('');
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
          specialRequests: requests
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
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Select new dates for your stay. Availability and price will be recalculated automatically.
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
        <Field label="Special requests (optional)">
          <textarea
            rows="2"
            value={requests}
            onChange={(e) => setRequests(e.target.value)}
            placeholder="High floor, quiet room, early arrival notice…"
          />
        </Field>
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
  const [bank, setBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState(booking.guestName || '');
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
          body: {
            reason,
            refundAccount: {
              bank: bank.trim(),
              accountNumber: accountNumber.trim(),
              holderName: holderName.trim()
            }
          }
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
            : 'According to hotel policy, cancellations requested > 48 hours before check-in receive a 100% deposit refund. Please provide your refund bank account details for front desk review.'}
        </p>

        <Field label="Reason for cancellation">
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="Change of travel plans">Change of travel plans</option>
            <option value="Found alternative accommodation">Found alternative accommodation</option>
            <option value="Unable to travel on chosen dates">Unable to travel on chosen dates</option>
            <option value="Other reason">Other reason</option>
          </select>
        </Field>

        {!isPending && (
          <>
            <Field label="Bank Name (for refund)">
              <input
                type="text"
                placeholder="e.g. Vietcombank, Techcombank, MB Bank"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                required
              />
            </Field>
            <Field label="Account Number">
              <input
                type="text"
                placeholder="Bank account number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                required
              />
            </Field>
            <Field label="Account Holder Name (must match booker)">
              <input
                type="text"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                required
              />
            </Field>
          </>
        )}

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

// UC10: a customer's own bookings, split into upcoming and past.
export function MyBookings() {
  const [tab, setTab] = useState('upcoming');
  const [open, setOpen] = useState(null);
  const [modifying, setModifying] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [notice, setNotice] = useState(null);

  const s = useApi('/bookings?limit=100');
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
                    <button className="btn" aria-expanded={open === b._id} aria-controls={`details-${b._id}`} onClick={() => setOpen(open === b._id ? null : b._id)}>
                      {open === b._id ? 'Hide details' : 'View details'}
                    </button>
                    {canModifyOrCancel && (
                      <>
                        <button className="btn" onClick={() => setModifying(b)}>Modify</button>
                        <button className="btn" onClick={() => setCancelling(b)}>
                          {b.status === 'pending' ? 'Abandon hold' : 'Cancel'}
                        </button>
                      </>
                    )}
                    {isCancellationRequested && (
                      <button className="btn" onClick={() => withdraw(b)}>
                        Withdraw request
                      </button>
                    )}
                    {b.status === 'checked_out' && <button className="btn">Write review</button>}
                  </div>
                </article>
                {open === b._id && <Details id={b._id} />}
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
    </div>
  );
}
