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
    setSaving(true); setError(null); setOk(null);
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const result = await api('/housekeeping/tasks/ad-hoc', { method: 'POST', body });
      event.currentTarget.reset();
      setOk(result.data.assignedTo ? 'Cleaning request created and assigned to the responsible staff member.' : 'Cleaning request created. No responsible staff is assigned for this shift yet.');
    } catch (x) { setError(x); } finally { setSaving(false); }
  };
  return <>
    <PageHead title="Ad-hoc cleaning request" sub="Request cleaning for a room. The task is assigned automatically using the responsibility plan for the current shift." />
    <form className="panel policy-form" onSubmit={submit}>
      <Field label="Room" error={error?.fields?.roomId}><select name="roomId" required disabled={rooms.loading}><option value="">Select room</option>{(rooms.data || []).map((room) => <option key={room._id} value={room._id}>Room {room.roomNumber} - Floor {room.floor} ({room.status})</option>)}</select></Field>
      <Field label="Request details" error={error?.fields?.requestContent}><textarea name="requestContent" maxLength="1000" placeholder="Example: Guest requests extra cleaning after lunch." required /></Field>
      <Notice error={error || rooms.error} ok={ok} />
      <button className="btn primary" disabled={saving || rooms.loading}>{saving ? 'Creating...' : 'Create cleaning request'}</button>
    </form>
  </>;
}
