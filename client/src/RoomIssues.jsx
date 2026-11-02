import { useState } from 'react';
import { api } from './api/client.js';
import { Field, Modal, Notice, PageHead, useApi } from './ui.jsx';
import { useAuth } from './context/Auth.jsx';

export default function RoomIssues() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  return <><PageHead title="Room issues" sub="Report damage or a room issue. High-severity issues move an empty room to Maintenance and alert the hotel team." action="Report issue" onAction={() => setOpen(true)} />
    <p className="muted">Report access: {user.roleName}. A Manager can review and resolve reported issues from the room details.</p>
    {open && <ReportIssue onClose={() => setOpen(false)} />}
  </>;
}

function ReportIssue({ onClose }) {
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [ok, setOk] = useState(null);
  const rooms = useApi('/room-issues/options');
  const submit = async (event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); setSaving(true); setError(null); try { const result = await api('/room-issues', { method: 'POST', body }); setOk(result.data.maintenanceApplied ? 'Reported. The room was moved to Maintenance.' : 'Room issue reported.'); event.currentTarget.reset(); } catch (x) { setError(x); } finally { setSaving(false); } };
  return <Modal title="Report room issue" onClose={onClose}><form className="form-grid" onSubmit={submit}>
    <Field label="Room" error={error?.fields?.roomId}><select name="roomId" required disabled={rooms.loading}><option value="">Select room</option>{(rooms.data || []).map((room) => <option key={room._id} value={room._id}>Room {room.roomNumber} - Floor {room.floor} ({room.status})</option>)}</select></Field>
    <Field label="Severity" error={error?.fields?.severity}><select name="severity" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
    <div className="full"><Field label="Issue title" error={error?.fields?.title}><input name="title" maxLength="120" required /></Field></div>
    <div className="full"><Field label="Description" error={error?.fields?.description}><textarea name="description" maxLength="2000" /></Field></div>
    <div className="full"><Notice error={error || rooms.error} ok={ok} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={saving || rooms.loading}>{saving ? 'Reporting...' : 'Report issue'}</button></div>
  </form></Modal>;
}
