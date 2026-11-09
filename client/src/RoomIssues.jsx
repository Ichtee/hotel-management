import { useState } from 'react';
import { api, dateLabel } from './api/client.js';
import { DataTable, Dialog, Field, Notice, PageHead, Screen, useApi, useScreen } from './ui.jsx';
import { useAuth } from './context/Auth.jsx';

// UC31: staff report an issue; UC23 3d: the Hotel Manager reviews the reports and closes them as Resolved.
export default function RoomIssues() {
  const { user } = useAuth();
  const manager = user.role === 'manager';
  const canReport = user.permissions.includes('room_issues.report');
  const sc = useScreen();
  const [filter, setFilter] = useState('open');
  const [msg, setMsg] = useState(null);
  const rooms = useApi('/room-issues/options', canReport);
  const list = useApi(`/room-issues?limit=100${filter ? `&status=${filter}` : ''}`, manager);
  const roomNo = (id) => (rooms.data || []).find((r) => r._id === id)?.roomNumber || '—';
  const resolve = async (issue) => {
    if (!window.confirm(`Close "${issue.title}" as resolved?`)) return;
    try { await api(`/room-issues/${issue._id}/resolve`, { method: 'PATCH', body: {} }); setMsg('Issue resolved. The room leaves Maintenance once no open issue remains.'); list.reload(); }
    catch (x) { setMsg(null); alert(x.message); }
  };
  if (sc.name === 'new') return <ReportIssue rooms={rooms} onClose={() => { if (manager) list.reload(); sc.close(); }} />;
  return <>
    <PageHead title="Room issues" sub="Report a damaged or missing item (charged to the guest after the front desk confirms it) or a room that cannot be used." action={canReport ? 'Report issue' : undefined} onAction={() => sc.go('new')} />
    {manager ? <>
      <div className="chips" style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        {[['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['', 'All']].map(([k, l]) => <button key={l} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => { setFilter(k); setMsg(null); }}>{l}</button>)}
      </div>
      <Notice error={list.error} ok={msg} />
      {list.loading ? <p className="muted">Loading…</p> : !list.data?.length ? <p className="empty">No issues here.</p> : (
        <DataTable cols={['Reported', 'Room', 'Issue', 'Severity', 'Status', '']} rows={list.data.map((i) => [
          dateLabel(i.createdAt), roomNo(i.roomId), <span key="t"><b>{i.title}</b>{i.description ? <small className="muted"><br />{i.description}</small> : null}</span>, i.severity, i.status,
          i.status !== 'resolved' ? <button key="r" className="btn sm" onClick={() => resolve(i)}>Resolve</button> : '',
        ])} />
      )}
    </> : <p className="muted">Reports go to the Hotel Manager, who closes them once the room is fixed.</p>}
  </>;
}

// UC31 popup: (a) a damaged / missing item charged to the guest (UC38) and / or (b) "The room cannot be used". At least one is required.
export function ReportIssue({ rooms, roomId, onClose }) {
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [ok, setOk] = useState(null);
  const submit = async (event) => {
    event.preventDefault(); const form = event.currentTarget; const f = Object.fromEntries(new FormData(form));
    const items = rooms.meta?.compensationItems || [];
    const item = items.find((i) => i._id === f.chargeItemId);
    const unusable = f.unusable === 'on';
    if (!item && !unusable) { setError({ message: 'Choose a damaged or missing item, or tick "The room cannot be used".' }); return; }
    if (unusable && !f.description.trim()) { setError({ message: 'Describe why the room cannot be used.', fields: { description: 'Required.' } }); return; }
    const body = { roomId: roomId || f.roomId, severity: unusable ? 'high' : 'low', description: f.description,
      title: unusable ? `Room cannot be used${item ? ` (${item.name})` : ''}` : `Damaged / missing: ${item.name}` };
    if (item) { body.chargeItemId = item._id; body.quantity = Number(f.quantity) || 1; }
    setSaving(true); setError(null); setOk(null);
    try {
      const result = await api('/room-issues', { method: 'POST', body });
      const parts = ['Reported.'];
      if (result.data.maintenanceApplied) parts.push('The room was moved to Maintenance.');
      if (item) parts.push(result.data.penalty ? 'The front desk will confirm the charge with the guest.' : 'No current or last stay was found for this room, so nothing was charged.');
      setOk(parts.join(' ')); form.reset();
    } catch (x) { setError(x); } finally { setSaving(false); }
  };
  const items = rooms.meta?.compensationItems || [];
  const Shell = roomId ? Dialog : Screen; // SRS UC31: a popup on the housekeeping task page, a page for the receptionist
  const fixed = roomId && (rooms.data || []).find((r) => r._id === roomId);
  return <Shell title={fixed ? `Report damage / issue · Room ${fixed.roomNumber}` : 'Report damage / issue'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {!roomId && <div className="full"><Field label="Room" error={error?.fields?.roomId}><select name="roomId" required disabled={rooms.loading}><option value="">Select room</option>{(rooms.data || []).map((room) => <option key={room._id} value={room._id}>Room {room.roomNumber} - Floor {room.floor} ({room.status})</option>)}</select></Field></div>}
    <Field label="Damaged or missing item" error={error?.fields?.chargeItemId}><select name="chargeItemId" defaultValue=""><option value="">None</option>{items.map((i) => <option key={i._id} value={i._id}>{i.name} · {i.price.toLocaleString('en-US')} VND</option>)}</select></Field>
    <Field label="Quantity" error={error?.fields?.quantity}><input name="quantity" type="number" min="1" max="20" defaultValue="1" /></Field>
    <label className="full check"><input type="checkbox" name="unusable" /> The room cannot be used (moves an empty room to Maintenance)</label>
    <div className="full"><Field label="Description" error={error?.fields?.description}><textarea name="description" maxLength="2000" placeholder="What happened? Required when the room cannot be used." /></Field></div>
    <div className="full"><Notice error={error || rooms.error} ok={ok} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={saving || rooms.loading}>{saving ? 'Reporting...' : 'Submit report'}</button></div>
  </form></Shell>;
}
