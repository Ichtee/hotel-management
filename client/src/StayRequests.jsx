import { useState } from 'react';
import { api, dateLabel } from './api/client.js';
import { Badge, DataTable, Field, Notice, PageHead, Screen, WaitScreen, useApi, useScreen } from './ui.jsx';

// date and hour in the hotel's time: the hour is what the receptionist decides on (BR-44)
const when = (v) => `${dateLabel(v)}, ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(v))}`;

// Front desk: opens the private ID photo of a request in a new tab through a 5-minute link (each view is audited).
export function IdPhotoLink({ requestId }) {
  const [error, setError] = useState(null);
  const open = async () => { setError(null); try { window.open((await api(`/frontdesk/requests/${requestId}/id-photo`)).data.url, '_blank', 'noopener'); } catch (x) { setError(x); } };
  return <span><button type="button" className="btn sm" onClick={open}>View ID photo</button><Notice error={error} /></span>;
}
export default function StayRequests() {
  const list = useApi('/frontdesk/requests?status=pending&limit=100');
  const sc = useScreen();
  const selected = (list.data || []).find((r) => r._id === sc.id);
  if (sc.name === 'review') return selected ? <HandleRequest request={selected} onClose={sc.close} onDone={() => { list.reload(); sc.close(); }} /> : <WaitScreen loading={list.loading} onClose={sc.close} />;
  return <>
    <PageHead title="Stay requests" sub="Approve or reject customer check-in and check-out requests. The quoted fee is shown but is charged only during the stay workflow." />
    <Notice error={list.error} />
    {list.loading ? <p className="muted">Loading requests...</p> : <DataTable cols={['Booking', 'Guest', 'Request', 'Requested time', 'Quoted fee', '']} rows={(list.data || []).map((request) => [request.bookingId?.bookingReference || 'Booking removed', request.customerId?.customerProfile?.fullName || request.bookingId?.guestName || 'Guest', <Badge v={request.type} />, when(request.requestedTime), `${request.quotedFee?.toLocaleString('en-US') || 0} VND`, <button className="btn sm" onClick={() => sc.go('review', request._id)}>Review</button>])} />}
    {!list.loading && !list.error && !(list.data || []).length && <p className="muted center-msg">There are no pending stay requests.</p>}
  </>;
}
function HandleRequest({ request, onClose, onDone }) {
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const handle = async (action) => { const responseNote = document.getElementById('request-note').value; setSaving(true); try { await api(`/frontdesk/requests/${request._id}`, { method: 'PATCH', body: { action, responseNote } }); onDone(); } catch (x) { setError(x); } finally { setSaving(false); } };
  return <Screen title="Review stay request" onClose={onClose}><div className="form-grid"><p className="full"><strong>{request.bookingId?.bookingReference}</strong> · {request.type.replace('_', ' ')} requested for {when(request.requestedTime)}.</p>{request.hasIdPhoto && <p className="full"><IdPhotoLink requestId={request._id} /></p>}{request.numberOfGuests && <p className="full">Pre-registration: {request.numberOfGuests} guest(s), main guest {request.mainGuestName}. The ID number is checked against the document at check-in.</p>}<p className="full muted">A rejection needs a response note. Customer note: {request.note || 'None'} · Quoted fee: {request.quotedFee?.toLocaleString('en-US') || 0} VND</p><div className="full"><Field label="Response note" error={error?.fields?.responseNote}><textarea id="request-note" maxLength="1000" /></Field></div><div className="full"><Notice error={error} /></div><div className="full modal-actions"><button className="btn" disabled={saving} onClick={() => handle('reject')}>Reject</button><button className="btn primary" disabled={saving} onClick={() => handle('approve')}>Approve</button></div></div></Screen>;
}
