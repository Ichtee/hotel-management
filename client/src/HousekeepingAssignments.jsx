import { useState } from 'react';
import { api, dateLabel } from './api/client.js';
import { DataTable, Field, Notice, PageHead, Screen, WaitScreen, useApi, useScreen } from './ui.jsx';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const endOfMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + 30 * 864e5));

export default function HousekeepingAssignments() {
  const plans = useApi('/housekeeping-assignments?isActive=true&limit=100');
  const options = useApi('/housekeeping-assignments/options');
  const sc = useScreen();
  const [error, setError] = useState(null);
  const staff = options.data?.staff || [];
  const rooms = options.data?.rooms || [];
  const labelFor = (id) => staff.find((person) => person._id === String(id))?.customerProfile?.fullName || staff.find((person) => person._id === String(id))?.email || 'Unknown staff';
  const roomScope = (plan) => [...(plan.floors || []).map((floor) => `Floor ${floor}`), ...(plan.roomIds || []).map((id) => rooms.find((room) => room._id === String(id))?.roomNumber || 'Room')].join(', ');
  const revoke = async (plan) => {
    if (!window.confirm(`Revoke ${labelFor(plan.staffId)}'s ${plan.shift} assignment?`)) return;
    try { await api(`/housekeeping-assignments/${plan._id}`, { method: 'DELETE', body: {} }); plans.reload(); } catch (x) { setError(x); }
  };
  if (sc.name === 'new') return options.loading ? <WaitScreen loading onClose={sc.close} /> : <CreateAssignment staff={staff} rooms={rooms} onClose={sc.close} onSaved={() => { plans.reload(); sc.close(); }} />;
  return <>
    <PageHead title="Housekeeping assignments" sub="Assign responsibility by room or floor and shift. Open tasks are automatically reassigned when a plan changes." action="New assignment" onAction={() => sc.go('new')} />
    <Notice error={error || plans.error || options.error} />
    {plans.loading || options.loading ? <p className="muted">Loading assignments...</p> : <DataTable cols={['Staff member', 'Shift', 'Responsibility', 'Effective period', '']} rows={(plans.data || []).map((plan) => [labelFor(plan.staffId), plan.shift, roomScope(plan), `${dateLabel(plan.effectiveFrom)} - ${dateLabel(plan.effectiveTo)}`, <button className="btn sm danger" onClick={() => revoke(plan)}>Revoke</button>])} />}
    {!plans.loading && !plans.error && !(plans.data || []).length && <p className="muted center-msg">No active assignments. Create one so cleaning tasks can be assigned automatically.</p>}
  </>;
}

function CreateAssignment({ staff, rooms, onClose, onSaved }) {
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [roomIds, setRoomIds] = useState([]);
  const [floors, setFloors] = useState([]);
  const uniqueFloors = [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b);
  const toggle = (value, values, setValues) => setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const submit = async (event) => {
    event.preventDefault(); const f = Object.fromEntries(new FormData(event.currentTarget)); setSaving(true); setError(null);
    try { await api('/housekeeping-assignments', { method: 'POST', body: { ...f, roomIds, floors } }); onSaved(); } catch (x) { setError(x); } finally { setSaving(false); }
  };
  return <Screen title="New housekeeping assignment" onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <Field label="Housekeeping staff" error={error?.fields?.staffId}><select name="staffId" required defaultValue=""><option value="">Select staff member</option>{staff.map((person) => <option value={person._id} key={person._id}>{person.customerProfile?.fullName || person.email}</option>)}</select></Field>
      <Field label="Shift" error={error?.fields?.shift}><select name="shift" defaultValue="morning"><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="night">Night</option></select></Field>
      <Field label="Effective from" error={error?.fields?.effectiveFrom}><input name="effectiveFrom" type="date" defaultValue={today()} required /></Field>
      <Field label="Effective to" error={error?.fields?.effectiveTo}><input name="effectiveTo" type="date" defaultValue={endOfMonth()} required /></Field>
      <fieldset className="full"><legend>Floors</legend><div className="chips">{uniqueFloors.map((floor) => <label key={floor} className="check"><input type="checkbox" checked={floors.includes(floor)} onChange={() => toggle(floor, floors, setFloors)} /> Floor {floor}</label>)}</div></fieldset>
      <fieldset className="full"><legend>Specific rooms</legend><p className="muted" style={{ margin: 0 }}>Optional when a floor is selected.</p><div className="chips">{rooms.map((room) => <label key={room._id} className="check"><input type="checkbox" checked={roomIds.includes(room._id)} onChange={() => toggle(room._id, roomIds, setRoomIds)} /> {room.roomNumber}</label>)}</div></fieldset>
      <div className="full"><Notice error={error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save assignment'}</button></div>
    </form>
  </Screen>;
}
