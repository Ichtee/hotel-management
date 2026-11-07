import { useEffect, useState } from 'react';
import { api, dateLabel, money } from './api/client.js';
import { Notice, useApi } from './ui.jsx';

const BANK_INFO = {
  bankId: 'MB',
  bankName: 'MBBank (Ngân hàng TMCP Quân Đội)',
  accountNo: '5202112004',
  accountName: 'DO NGUYEN QUANG SON',
};

const METHODS = [
  ['bank_transfer', 'Bank transfer (VietQR)', 'Scan QR code with any banking app (MBBank)'],
  ['credit_card', 'Credit or debit card', 'Visa, Mastercard, JCB'],
];







const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const refOf = (b) => b.bookingReference || b._id.slice(-8).toUpperCase();

function useCountdown(until) {
  const [left, setLeft] = useState(() => (until ? new Date(until) - Date.now() : null));
  useEffect(() => {
    if (!until) return undefined;
    setLeft(new Date(until) - Date.now());
    const t = setInterval(() => setLeft(new Date(until) - Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}
const Back = () => <p><a href="#/my-bookings">← Back to my bookings</a></p>;

// SePay checkout is a plain form POST to the gateway's own domain; the server already signed the fields.
function postForm({ action, fields }) {
  const form = Object.assign(document.createElement('form'), { method: 'POST', action });
  for (const [name, value] of Object.entries(fields)) form.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
  document.body.append(form);
  form.submit();
}

// Payment screen (UC10). BR-14: the deposit is the only online payment; the balance is paid at the front desk (UC11).
export function PaymentPage({ id, kind }) {
  const s = useApi(`/bookings/${id}`, kind === 'deposit');
  const offered = useApi('/payments/methods'); // which methods this deployment's gateway offers
  const [picked, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState('');
  const copyText = (text, label) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };
  const b = s.data;
  const left = useCountdown(b?.status === 'pending' ? b.holdExpiresAt : null);
  if (kind !== 'deposit') return <div className="c-wrap c-section pay"><Back /><Notice error="Only the deposit is paid online. The balance is paid at the front desk at check-out." /></div>;
  const due = b ? b.depositRequired : 0;
  const lapsed = b && (b.status !== 'pending' || (left !== null && left <= 0));
  const payable = b && offered.data && !lapsed && due >= 1;
  const options = METHODS.filter(([v]) => offered.data?.methods.includes(v));
  const method = options.some(([v]) => v === picked) ? picked : options[0]?.[0];
  const bookingRef = b ? refOf(b) : '';
  const qrUrl = b
    ? `https://img.vietqr.io/image/${BANK_INFO.bankId}-${BANK_INFO.accountNo}-compact2.png?amount=${Math.round(due)}&addInfo=${encodeURIComponent(bookingRef)}&accountName=${encodeURIComponent(BANK_INFO.accountName)}`
    : '';

  const confirmBankTransfer = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api(`/bookings/${id}/payments/${kind}`, { method: 'POST', body: { method: 'bank_transfer' } });
      const orderId = r.data.orderId;
      const paymentId = r.data.paymentId;
      await api(`/sandbox-gateway/orders/${orderId}`, { method: 'POST', body: { result: 'success' } });
      location.hash = `#/pay/result?payment=${paymentId}`;
    } catch (x) {
      setErr(x);
      setBusy(false);
    }
  };
  const pay = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api(`/bookings/${id}/payments/${kind}`, { method: 'POST', body: { method } });
      if (r.data.checkout) return postForm(r.data.checkout);
      location.hash = r.data.payUrl;
    } catch (x) { setErr(x); setBusy(false); }
  };
  return (
    <div className="c-wrap c-section pay">
      <Back />
      <h1 className="title">Pay your deposit</h1>
      <div aria-busy={s.loading}>
        {s.loading && <div className="skel-card" aria-hidden="true" />}
        {s.error && <div className="empty"><Notice error={s.error} /><button className="btn" onClick={s.reload}>Try again</button></div>}
        {b && (
          <>
            <section className="panel pay-sum" aria-label="Booking summary">
              <p className="muted">{refOf(b)} · {b.rooms.map((r) => r.roomTypeId?.name).filter(Boolean).join(', ') || 'Room'} · {dateLabel(b.checkInDate)} – {dateLabel(b.checkOutDate)}</p>
              <p className="amount">{money(Math.max(0, due))}</p>
              <p className="muted">Deposit to confirm your reservation (booking total {money(b.totalAmount)}). The rest is paid at the front desk at check-out.</p>
              {!lapsed && left !== null && <p className="hold" role="timer">Your room is held for <strong>{mmss(left)}</strong></p>}
            </section>
            {lapsed && (
              <div className="empty">
                <Notice error={b.status === 'pending' || b.status === 'expired' ? 'The 15-minute room hold has expired, so this reservation was released.' : 'This booking is not waiting for a deposit.'} />
                <a className="btn primary" href="#/rooms">Browse rooms</a>
              </div>
            )}
            {!lapsed && due < 1 && <div className="empty"><h2>Nothing left to pay</h2><p className="muted">This booking is fully paid.</p></div>}
            {payable && (
              <form className="panel pay-form" onSubmit={(e) => { e.preventDefault(); pay(); }}>
                <fieldset className="methods">
                  <legend>Payment method</legend>
                  {options.map(([v, name, hint]) => (
                    <label key={v} className={method === v ? 'method on' : 'method'}>
                      <input type="radio" name="method" value={v} checked={method === v} onChange={() => setMethod(v)} />
                      <span><strong>{name}</strong><small className="muted">{hint}</small></span>
                    </label>
                  ))}
                </fieldset>
                <Notice error={err} />
                {method === 'bank_transfer' ? (
                  <div style={{ marginTop: '1.25rem', padding: '1.25rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#0f172a' }}>
                      Scan VietQR to pay your deposit
                    </h3>
                    <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                      Open any banking app (MBBank, Vietcombank, Techcombank...) and scan the QR code to transfer:
                    </p>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ background: '#fff', padding: '12px', borderRadius: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                        <img
                          src={qrUrl}
                          alt="VietQR MBBank"
                          style={{ width: '280px', height: 'auto', display: 'block', borderRadius: '8px' }}
                        />
                      </div>

                      <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.95rem' }}>
                        <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                          <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>Bank</span>
                          <strong>{BANK_INFO.bankName}</strong>
                        </div>

                        <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>Account number</span>
                            <strong style={{ fontSize: '1.1rem', color: '#0369a1' }}>{BANK_INFO.accountNo}</strong>
                          </div>
                          <button type="button" className="btn sm" onClick={() => copyText(BANK_INFO.accountNo, 'stk')}>
                            {copied === 'stk' ? '✓ Copied' : 'Copy account number'}
                          </button>
                        </div>

                        <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                          <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>Account name</span>
                          <strong>{BANK_INFO.accountName}</strong>
                        </div>

                        <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>Deposit amount</span>
                            <strong style={{ fontSize: '1.1rem', color: '#16a34a' }}>{money(due)}</strong>
                          </div>
                          <button type="button" className="btn sm" onClick={() => copyText(String(Math.round(due)), 'tien')}>
                            {copied === 'tien' ? '✓ Copied' : 'Copy amount'}
                          </button>
                        </div>

                        <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>Transfer description</span>
                            <strong style={{ fontSize: '1.05rem', color: '#dc2626' }}>{bookingRef}</strong>
                          </div>
                          <button type="button" className="btn sm" onClick={() => copyText(bookingRef, 'nd')}>
                            {copied === 'nd' ? '✓ Copied' : 'Copy description'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn primary wide"
                        style={{ fontSize: '1.05rem', padding: '12px 24px' }}
                        disabled={busy}
                        onClick={confirmBankTransfer}
                      >
                        {busy ? 'Verifying transfer…' : '✓ I have completed the transfer'}
                      </button>
                      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '8px' }}>
                        After completing the transfer via your banking app, click the button above to confirm your reservation.
                      </p>
                    </div>
                  </div>
                ) : null}
                {method !== 'bank_transfer' && (
                  <button className="btn primary wide" type="submit" disabled={busy} style={{ marginTop: '1rem' }}>
                    {busy ? 'Opening gateway…' : `Pay ${money(due)} with card`}
                  </button>
                )}
                {method !== 'bank_transfer' && (
                  <p className="muted fine">You will be sent to the payment gateway{offered.data.provider === 'sandbox' ? ' (sandbox)' : ''} to confirm.</p>
                )}
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Sandbox stand-in for the gateway's hosted checkout. A real provider replaces this page.
export function SandboxGateway({ orderId, paymentId }) {
  const s = useApi(paymentId ? `/payments/${paymentId}` : '', Boolean(paymentId));
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState('');
  const copyText = (text, label) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };
  const finish = async (result) => {
    setBusy(result); setErr(null);
    try {
      await api(`/sandbox-gateway/orders/${orderId}`, { method: 'POST', body: { result } });
      location.hash = `#/pay/result?payment=${paymentId}`;
    } catch (x) { setErr(x); setBusy(null); }
  };
  const p = s.data;
  return (
    <div className="c-wrap c-section pay">
      <div className="gw-banner" role="note"><strong>Sandbox gateway</strong> · test environment, no real money is moved.</div>
      <h1 className="title">Confirm payment</h1>
      {paymentId && s.loading && <div className="skel-card" aria-hidden="true" />}
      {s.error && <Notice error={s.error} />}
      {!paymentId && <Notice error="Missing payment reference." />}
      {p && (
        <section className="panel pay-sum">
          <p className="muted">Order {orderId} · booking {p.booking.bookingReference || p.bookingId.slice(-8).toUpperCase()}</p>
          <p className="amount">{money(p.amount)}</p>
          {p.status !== 'pending' ? (
            <p>This order is already {p.status}. <a href={`#/pay/result?payment=${paymentId}`}>See the result</a></p>
          ) : (
            <>
              <Notice error={err} />
              <div className="gw-actions">
                <button className="btn primary" disabled={Boolean(busy)} onClick={() => finish('success')}>{busy === 'success' ? 'Approving…' : 'Approve payment'}</button>
                <button className="btn" disabled={Boolean(busy)} onClick={() => finish('failed')}>{busy === 'failed' ? 'Declining…' : 'Decline payment'}</button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// Payment Result screen. The gateway's callback may land a moment after the redirect, so poll briefly while pending.
export function PaymentResult({ paymentId, back }) {
  const s = useApi(paymentId ? `/payments/${paymentId}` : '', Boolean(paymentId));
  const [tries, setTries] = useState(0);
  const status = s.data?.status;
  useEffect(() => {
    if (status !== 'pending' || tries >= 8) return undefined;
    const t = setTimeout(() => { setTries(tries + 1); s.reload(); }, 1500);
    return () => clearTimeout(t);
  }, [status, tries]);
  const p = s.data;
  return (
    <div className="c-wrap c-section pay center">
      {!paymentId && <div className="empty"><Notice error="Missing payment reference." /><a className="btn" href="#/my-bookings">My bookings</a></div>}
      {paymentId && s.loading && !p && <div className="skel-card" aria-hidden="true" />}
      {s.error && <div className="empty"><Notice error={s.error} /><a className="btn" href="#/my-bookings">My bookings</a></div>}
      {p && (
        <div role="status" className="result">
          {p.status === 'success' && <>
            <p className="done" aria-hidden="true">✓</p>
            <h1 className="title">Payment received</h1>
            <p>{money(p.amount)} paid for booking <strong>{p.booking.bookingReference || p.bookingId.slice(-8).toUpperCase()}</strong>.</p>
            {p.kind === 'deposit' && p.booking.status === 'confirmed' && <p className="muted">Your reservation is confirmed.</p>}
            {p.kind === 'deposit' && p.booking.status !== 'confirmed' && <p className="muted">The room hold had already expired, so this deposit will be refunded by the front desk.</p>}
          </>}
          {p.status === 'failed' && <>
            <p className="done bad-circle" aria-hidden="true">✕</p>
            <h1 className="title">Payment failed</h1>
            <p>{p.failureReason || 'The payment was not completed'}. You have not been charged.</p>
            <p><a className="btn primary" href={`#/pay/${p.bookingId}?kind=${p.kind}`}>Try again</a></p>
          </>}
          {p.status === 'pending' && (back === 'cancel' || back === 'error' ? <>
            <h1 className="title">Payment not completed</h1>
            <p className="muted">{back === 'cancel' ? 'You cancelled the payment.' : 'The gateway reported a problem.'} If you already paid, this page updates shortly.</p>
            <p><a className="btn primary" href={`#/pay/${p.bookingId}?kind=${p.kind}`}>Try again</a></p>
          </> : <>
            <h1 className="title">Waiting for confirmation…</h1>
            <p className="muted">{tries >= 8 ? 'The gateway has not confirmed yet. Check My bookings in a moment.' : 'This usually takes a few seconds.'}</p>
          </>)}
          <p><a className="btn" href="#/my-bookings">View my bookings</a></p>
        </div>
      )}
    </div>
  );
}
