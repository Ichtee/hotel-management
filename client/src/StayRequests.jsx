import { useState } from 'react';
import { api, dateLabel } from './api/client.js';
import { Badge, DataTable, Field, Modal, Notice, PageHead, useApi } from './ui.jsx';

export default function StayRequests() {
  const list = useApi('/frontdesk/requests?status=pending&limit=100');
  const [selected, setSelected] = useState(null);
  return <>
    <PageHead title="Stay requests" sub="Approve or reject customer check-in and check-out requests. The quoted fee is shown but is charged only during the stay workflow." />
    <Notice error={list.error} />
    {list.loading ? <p className="muted">Loading requests...</p> : <DataTable cols={['Booking', 'Guest', 'Request', 'Requested time', 'Quoted fee', '']} rows={(list.data || []).map((request) => [request.bookingId?.bookingReference || 'Booking removed', request.customerId?.customerProfile?.fullName || request.bookingId?.guestName || 'Guest', <Badge v={request.type} />, dateLabel(request.requestedTime), `${request.quotedFee?.toLocaleString('en-US') || 0} VND`, <button className="btn sm" onClick={() => setSelected(request)}>Review</button>])} />}
    {!list.loading && !list.error && !(list.data || []).length && <p className="muted center-msg">There are no pending stay requests.</p>}
    {selected && <HandleRequest request={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); list.reload(); }} />}
  </>;
}
function HandleRequest({ request, onClose, onDone }) {
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const handle = async (action) => { const responseNote = document.getElementById('request-note').value; setSaving(true); try { await api(`/frontdesk/requests/${request._id}`, { method: 'PATCH', body: { action, responseNote } }); onDone(); } catch (x) { setError(x); } finally { setSaving(false); } };
  return <Modal title="Review stay request" onClose={onClose}><div className="form-grid"><p className="full"><strong>{request.bookingId?.bookingReference}</strong> · {request.type.replace('_', ' ')} requested for {dateLabel(request.requestedTime)}.</p><p className="full muted">Customer note: {request.note || 'None'} · Quoted fee: {request.quotedFee?.toLocaleString('en-US') || 0} VND</p><div className="full"><Field label="Response note" error={error?.fields?.responseNote}><textarea id="request-note" maxLength="1000" /></Field></div><div className="full"><Notice error={error} /></div><div className="full modal-actions"><button className="btn" disabled={saving} onClick={() => handle('reject')}>Reject</button><button className="btn primary" disabled={saving} onClick={() => handle('approve')}>Approve</button></div></div></Modal>;
}
