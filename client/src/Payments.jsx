import { useEffect, useState } from 'react';
import { api, dateLabel, money } from './api/client.js';
import { Notice, useApi } from './ui.jsx';

const METHODS = [
  ['bank_transfer', 'Bank transfer (VietQR)', 'Scan the QR code with any banking app; the gateway confirms it'],
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

// Gửi biểu mẫu đã được máy chủ ký trực tiếp đến cổng SePay.
function postForm({ action, fields }) {
  const form = Object.assign(document.createElement('form'), { method: 'POST', action });
  for (const [name, value] of Object.entries(fields)) form.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
  document.body.append(form);
  form.submit();
}

// Chỉ trả cọc trực tuyến; số tiền còn lại thanh toán tại quầy.
export function PaymentPage({ id, kind }) {
  const s = useApi(`/bookings/${id}`, kind === 'deposit');
  // Lấy các phương thức mà cổng thanh toán hiện tại hỗ trợ.
  const offered = useApi('/payments/methods');
  const [picked, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const b = s.data;
  const left = useCountdown(b?.status === 'pending' ? b.holdExpiresAt : null);
  if (kind !== 'deposit') return <div className="c-wrap c-section pay"><Back /><Notice error="Only the deposit is paid online. The balance is paid at the front desk at check-out." /></div>;
  const due = b ? b.depositRequired : 0;
  const lapsed = b && (b.status !== 'pending' || (left !== null && left <= 0));
  const payable = b && offered.data && !lapsed && due >= 1;
  const options = METHODS.filter(([v]) => offered.data?.methods.includes(v));
  const method = options.some(([v]) => v === picked) ? picked : options[0]?.[0];
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
                <button className="btn primary wide" type="submit" disabled={busy} style={{ marginTop: '1rem' }}>
                  {busy ? 'Opening gateway…' : `Pay ${money(due)}${method === 'bank_transfer' ? ' by bank transfer' : ' with card'}`}
                </button>
                <p className="muted fine">You will be sent to the payment gateway{offered.data.provider === 'sandbox' ? ' (sandbox)' : ''}; the booking is confirmed only when the gateway confirms the payment.</p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Trang thanh toán giả lập để thử nghiệm, không chuyển tiền thật.
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

// Thăm dò ngắn khi còn chờ vì thông báo từ cổng có thể đến sau chuyển hướng.
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
