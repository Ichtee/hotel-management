import { useState } from 'react';
import { api } from './api/client.js';
import { Field, Notice, PageHead, useApi } from './ui.jsx';

export default function AdHocCleaningRequest() {
  const rooms = useApi('/housekeeping/tasks/ad-hoc/options');
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget; // React clears currentTarget after await
    setSaving(true); setError(null); setOk(null);
    try {
      const f = Object.fromEntries(new FormData(form));
      const body = { roomId: f.roomId, requestContent: f.requestContent, priority: f.priority, ...(f.time ? { preferredTime: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())}T${f.time}:00+07:00` } : {}), ...(f.assignTo ? { assignTo: f.assignTo } : {}) };
      const result = await api('/housekeeping/tasks/ad-hoc', { method: 'POST', body });
      form.reset();
      setOk(result.data.assignedTo ? 'Cleaning request created and assigned to the responsible staff member.' : 'Cleaning request created. No responsible staff is assigned for this shift yet.');
    } catch (x) { setError(x); } finally { setSaving(false); }
  };
  return <>
    <PageHead title="Ad-hoc cleaning request" sub="Request cleaning for a room. The task is assigned automatically using the responsibility plan for the current shift." />
    <form className="panel policy-form" onSubmit={submit}>
      <Field label="Room" error={error?.fields?.roomId}><select name="roomId" required disabled={rooms.loading}><option value="">Select room</option>{(rooms.data || []).map((room) => <option key={room._id} value={room._id}>Room {room.roomNumber} - Floor {room.floor} ({room.status})</option>)}</select></Field>
      <Field label="Request details" error={error?.fields?.requestContent}><textarea name="requestContent" maxLength="1000" placeholder="Example: Guest requests extra cleaning after lunch." required /></Field>
      <Field label="Priority"><select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></Field>
      <Field label="Preferred time today (empty = as soon as possible)"><input name="time" type="text" inputMode="numeric" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="HH:mm" maxLength={5} title="24-hour time, for example 14:00" /></Field>
      {/* UC37 4a: used only when nobody is responsible for the room in this shift */}
      <Field label="If nobody is responsible for the room: staff on duty"><select name="assignTo" defaultValue=""><option value="">Assign by the responsibility plan</option>{(rooms.meta?.onDuty || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></Field>
      <Notice error={error || rooms.error} ok={ok} />
      <button className="btn primary" disabled={saving || rooms.loading}>{saving ? 'Creating...' : 'Create cleaning request'}</button>
    </form>
  </>;
}
