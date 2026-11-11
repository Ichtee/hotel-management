import { useState } from 'react';
import { api, dateLabel, money } from './api/client.js';
import { Badge, DataTable, Field, Notice, PageHead, Screen, WaitScreen, useApi, useScreen } from './ui.jsx';

const Booker = ({ p }) => <span>{p.name || '—'}<br /><small className="muted">{p.phone || 'no phone'} · {p.email || 'no e-mail'}</small></span>;
const Loading = ({ s, empty }) => s.loading ? <p className="muted">Loading…</p> : s.error ? <Notice error={s.error} /> : s.data.length === 0 ? <p className="empty muted">{empty}</p> : null;

// UC35: requests waiting for review (never rejected; approved automatically after 24 h or at check-in).
export function Cancellations() {
  const list = useApi('/frontdesk/cancellations');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const sc = useScreen();
  // UC35 1a: withdrawn at the customer's request; the booking is Confirmed again.
  const withdraw = async (b) => {
    if (!window.confirm(`Withdraw the cancellation request of ${b.bookingReference} at the customer's request?`)) return;
    try { setMsg((await api(`/frontdesk/cancellations/${b._id}/withdraw`, { method: 'POST' })).message); setErr(null); list.reload(); } catch (x) { setErr(x); }
  };
  const approve = async (b) => {
    if (!confirm(`Approve the cancellation of ${b.bookingReference}? Refund: ${money(b.cancellation.refundableAmount)}.`)) return;
    try { setMsg((await api(`/frontdesk/cancellations/${b._id}/approve`, { method: 'POST' })).message); setErr(null); list.reload(); } catch (x) { setErr(x); }
  };
  if (sc.name === 'record') return <RecordCancellation onClose={sc.close} onDone={(m) => { setMsg(m); setErr(null); list.reload(); sc.close(); }} />;
  return (
    <>
      <PageHead title="Cancellations" sub="Requests waiting for review. Undecided ones are approved automatically after 24 hours or at check-in." action="Record cancellation" onAction={() => sc.go('record')} />
      <Notice error={err} ok={msg} />
      <Loading s={list} empty="No cancellation requests are waiting." />
      {list.data?.length > 0 && (
        <DataTable cols={['Booking', 'Booker', 'Requested', 'Reason', 'Deposit paid', 'Refund', '']} rows={list.data.map((b) => [
          <span key="r" className="nw"><b>{b.bookingReference}</b><small className="muted" style={{ display: 'block' }}>{dateLabel(b.checkInDate)} – {dateLabel(b.checkOutDate)}</small></span>,
          <Booker key="p" p={b.booker} />,
          <span key="q" className="nw">{dateLabel(b.cancellation.requestedAt)}<small className="muted" style={{ display: 'block' }}>{b.cancellation.channel === 'online' ? 'Online' : `Front desk (${b.cancellation.verifyMethod === 'otp' ? 'OTP' : 'ID'})`}</small></span>,
          b.cancellation.reason || '—',
          money(b.depositPaid), money(b.cancellation.refundableAmount),
          <span key="a" className="row-actions"><button className="btn sm primary" onClick={() => approve(b)}>Approve</button><button className="btn sm" onClick={() => withdraw(b)}>Withdraw</button></span>,
        ])} />
      )}
    </>
  );
}

// UC16: find the booking, verify the requester (ID document at the desk or OTP by phone), enter the reason.
function RecordCancellation({ onClose, onDone }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [pick, setPick] = useState(null);
  const [method, setMethod] = useState('id_document');
  const [hotel, setHotel] = useState(false);
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = async (e) => {
    e.preventDefault();
    setErr(null); setPick(null);
    try { setFound((await api(`/frontdesk/cancellations/lookup?q=${encodeURIComponent(q.trim())}`)).data); } catch (x) { setErr(x); }
  };
  const choose = (b) => { setPick(b); setMethod('id_document'); setHotel(false); setSent(false); setOtp(''); };
  const sendCode = async () => {
    try { await api(`/frontdesk/bookings/${pick._id}/cancel-otp`, { method: 'POST' }); setSent(true); setErr(null); } catch (x) { setErr(x); }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!confirm(`Record the cancellation of ${pick.bookingReference}?`)) return;
    const body = hotel
      ? { bookingId: pick._id, hotelCaused: true, ...(reason.trim() ? { reason } : {}) }
      : { bookingId: pick._id, reason, verifyMethod: method, ...(method === 'otp' ? { otp } : {}) };
    setBusy(true);
    try { onDone((await api('/frontdesk/cancellations', { method: 'POST', body })).message); } catch (x) { setErr(x); setBusy(false); }
  };
  const est = pick && (hotel ? pick.hotelCausedEstimate : pick.estimate);
  const walkIn = pick?.bookingSource === 'front_desk';
  return (
    <Screen title="Record a cancellation" onClose={onClose}>
      <form className="form" onSubmit={search} role="search">
        <Field label="Booking code or phone number"><input value={q} onChange={(e) => setQ(e.target.value)} minLength={3} required autoFocus /></Field>
        <button className="btn">Find booking</button>
      </form>
      {found && !found.length && <p className="muted">No booking matches.</p>}
      {found?.length > 0 && !pick && (
        <ul className="lines" aria-label="Matching bookings">
          {found.map((b) => (
            <li key={b._id}>
              <span>{b.bookingReference} · {b.booker.name} · {dateLabel(b.checkInDate)}</span>
              <span><Badge v={b.status} /> {b.status === 'confirmed' && <button className="btn sm" onClick={() => choose(b)}>Select</button>}</span>
            </li>
          ))}
        </ul>
      )}
      {found?.some((b) => b.status === 'cancellation_requested') && !pick && <p className="muted">A booking with a pending request is approved from the list instead.</p>}
      {pick && (
        <form className="form" onSubmit={submit}>
          <p><strong>{pick.bookingReference}</strong> · {pick.booker.name} · {dateLabel(pick.checkInDate)} – {dateLabel(pick.checkOutDate)} <button type="button" className="btn sm" onClick={() => setPick(null)}>Change</button></p>
          <label className="check"><input type="checkbox" checked={hotel} onChange={(e) => setHotel(e.target.checked)} /> The hotel cannot provide the room (full refund, approved at once)</label>
          {!hotel && (
            <fieldset className="choice">
              <legend>Requester verified by</legend>
              <label className="check"><input type="radio" name="vm" checked={method === 'id_document'} onChange={() => setMethod('id_document')} /> ID document checked at the desk</label>
              <label className="check"><input type="radio" name="vm" checked={method === 'otp'} disabled={walkIn} onChange={() => setMethod('otp')} /> Phone call: code sent to {pick.booker.email || 'the account e-mail'}</label>
              {walkIn && <small className="muted">Walk-in bookings are cancelled only at the desk.</small>}
              {method === 'otp' && (
                <div className="otp-row">
                  <button type="button" className="btn sm" onClick={sendCode}>{sent ? 'Send a new code' : 'Send code'}</button>
                  <Field label="Code read out by the customer" error={err?.fields?.otp}><input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" pattern="\d{6}" maxLength={6} required /></Field>
                </div>
              )}
            </fieldset>
          )}
          <Field label={hotel ? 'Reason (optional)' : 'Reason'} error={err?.fields?.reason}><textarea rows="2" maxLength="500" value={reason} onChange={(e) => setReason(e.target.value)} required={!hotel} /></Field>
          {est && <p>{est.depositPaid < 1 ? 'No deposit paid: the booking is cancelled at once.' : `Refund ${money(est.refundableAmount)} of the ${money(est.depositPaid)} deposit${hotel ? '' : ' (locked now, approved in the requests list)'}.`}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Record cancellation'}</button>
        </form>
      )}
      <Notice error={err && !err.fields ? err : null} />
    </Screen>
  );
}

// UC21: refunds are transferred by bank outside the system; the amount is locked.
export function Refunds() {
  const [tab, setTab] = useState('requested');
  const list = useApi(`/frontdesk/refunds?status=${tab}`);
  const sc = useScreen();
  const open = (list.data || []).find((r) => r._id === sc.id);
  const [msg, setMsg] = useState(null);
  if (sc.name === 'process') return open ? <RefundCase r={open} onClose={sc.close} onChanged={() => list.reload()} onDone={(m) => { setMsg(m); list.reload(); sc.close(); }} /> : <WaitScreen loading={list.loading} onClose={sc.close} />;
  return (
    <>
      <PageHead title="Refunds" sub="Contact the customer for the bank account, transfer the refund and record the transaction code (target: within 7 days)" />
      <div className="chips" role="group" aria-label="Refund status">
        {[['requested', 'Waiting for refund'], ['completed', 'Refunded']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'chip on' : 'chip'} aria-pressed={tab === k} onClick={() => { setTab(k); setMsg(null); }}>{label}</button>
        ))}
      </div>
      <Notice ok={msg} />
      <Loading s={list} empty={tab === 'requested' ? 'Nothing is waiting for a refund.' : 'No refunds recorded yet.'} />
      {list.data?.length > 0 && (tab === 'requested' ? (
        <DataTable cols={['Booking', 'Booker', 'Amount', 'Reason', 'Waiting since', 'Phone', 'Contacts', '']} rows={list.data.map((r) => [
          r.booking.bookingReference, <Booker key="p" p={r.booker} />, money(r.amount), r.reason || '—', dateLabel(r.createdAt),
          r.booker.phone || '—', r.contacts.length,
          <button key="o" className="btn sm primary" onClick={() => sc.go('process', r._id)}>Process</button>,
        ])} />
      ) : (
        <DataTable cols={['Booking', 'Booker', 'Amount', 'Bill', 'Refunded']} rows={list.data.map((r) => [
          r.booking.bookingReference, <Booker key="p" p={r.booker} />, money(r.amount), r.hasBill ? <BillLink key="b" refundId={r._id} /> : r.bankTransactionCode || '—', dateLabel(r.processedAt),
        ])} />
      ))}
    </>
  );
}

// Opens the private bill photo in a new tab through a 5-minute link (each view is audited).
function BillLink({ refundId }) {
  const [error, setError] = useState(null);
  const open = async () => { setError(null); try { window.open((await api(`/frontdesk/refunds/${refundId}/bill`)).data.url, '_blank', 'noopener'); } catch (x) { setError(x); } };
  return <span><button type="button" className="btn sm" onClick={open}>View bill</button><Notice error={error} /></span>;
}

function RefundCase({ r, onClose, onChanged, onDone }) {
  const [err, setErr] = useState(null);
  const fe = (k) => err?.fields?.[k];
  const call = async (path, method, body, then) => {
    try { const res = await api(`/frontdesk/refunds/${r._id}${path}`, { method, body }); setErr(null); then(res); } catch (x) { setErr(x); }
  };
  const form = (e) => Object.fromEntries(new FormData(e.target));
  const saveAccount = (e) => { e.preventDefault(); call('/account', 'PUT', form(e), (res) => onChanged(res.data)); };
  const addNote = (e) => { e.preventDefault(); const el = e.target; call('/contacts', 'POST', form(e), (res) => { el.reset(); onChanged(res.data); }); };
  const record = async (e) => {
    e.preventDefault();
    const f = form(e);
    const file = f.bill;
    if (!file?.size || file.size > 5e6 || !/^image\/(jpeg|png)$/.test(file.type)) return setErr({ fields: { billPhoto: 'Choose the bill as a JPG or PNG photo of at most 5 MB.' } });
    if (!confirm(`Confirm that ${money(r.amount)} was transferred to ${r.booker.name}?`)) return;
    try {
      const p = (await api(`/frontdesk/refunds/${r._id}/bill-upload`)).data; // signed: goes straight to Cloudinary, private
      const fd = new FormData(); fd.append('file', file);
      for (const [k, val] of [['api_key', p.apiKey], ['timestamp', p.timestamp], ['folder', p.folder], ['type', p.type], ['format', p.format], ['signature', p.signature]]) fd.append(k, val);
      const up = await fetch(`https://api.cloudinary.com/v1_1/${p.cloudName}/image/upload`, { method: 'POST', body: fd });
      const out = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(`The bill could not be uploaded (${out.error?.message || up.status}). Try again.`);
      call('', 'POST', { billPhoto: out.public_id, ...(f.note ? { note: f.note } : {}) }, (res) => onDone(res.message));
    } catch (x) { setErr(x); }
  };
  return (
    <Screen title={`Refund · ${r.booking.bookingReference}`} onClose={onClose}>
      <dl className="kv">
        <dt>Amount</dt><dd><strong>{money(r.amount)}</strong> (cannot be changed)</dd>
        <dt>Payment</dt><dd>{r.payment ? `${r.payment.method.replace('_', ' ')} · ${r.payment.reference || '—'} · ${dateLabel(r.payment.paidAt)}` : 'Not identified'}</dd>
        <dt>Reason</dt><dd>{r.reason || '—'}</dd>
      </dl>
      <h3>1. Customer to contact</h3>
      <dl className="kv">
        <dt>Name</dt><dd>{r.booker.name}</dd>
        <dt>Phone / Zalo</dt><dd>{r.booker.phone || 'no phone'}</dd>
        <dt>E-mail</dt><dd>{r.booker.email || 'no e-mail'}</dd>
      </dl>
      <p className="muted">Call or message the customer to agree on the bank account, then transfer the refund.</p>
      <h3>2. Contact attempts</h3>
      {r.contacts.length > 0 && <ul className="lines">{r.contacts.map((c, i) => <li key={i}><span>{c.note}</span><span className="muted">{dateLabel(c.at)}</span></li>)}</ul>}
      <form className="form inline" onSubmit={addNote}>
        <Field label="Note" error={fe('note')}><input name="note" maxLength="500" placeholder="e.g. No answer, called at 10:00" required /></Field>
        <button className="btn">Add note</button>
      </form>
      <h3>3. Record the transfer</h3>
      {(
        <form className="form" onSubmit={record}>
          <Field label="Photo of the transfer bill (JPG or PNG)" error={fe('billPhoto')}><input name="bill" type="file" accept="image/jpeg,image/png" required /></Field>
          <Field label="Note (optional)"><input name="note" maxLength="500" /></Field>
          <button className="btn primary">Record refund</button>
        </form>
      )}
      <Notice error={err && !err.fields ? err : null} />
    </Screen>
  );
}
