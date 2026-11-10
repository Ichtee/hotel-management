import { useEffect, useState } from 'react';
import { api, money } from './api/client.js';
import { DataTable, Notice, PageHead } from './ui.jsx';

const day = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 864e5));
export default function RoomAvailability() {
  const [form, setForm] = useState({ checkIn: day(0), checkOut: day(1), guests: '1' });
  const [rows, setRows] = useState(null); const [error, setError] = useState(null); const [loading, setLoading] = useState(false);
  const search = async (event) => { event?.preventDefault(); setLoading(true); setError(null); try { const q = new URLSearchParams(form); const result = await api(`/rooms/search?${q}`); setRows(result.data || []); } catch (x) { setError(x); } finally { setLoading(false); } };
  useEffect(() => { if (form.checkIn && form.checkOut >= form.checkIn && form.guests) search(); }, [form]); // load on open and on every change; Search button stays as a refresh
  return <><PageHead title="Room availability" sub="Check available physical rooms for a guest's stay before creating or modifying a front-desk booking." />
    <form className="chips" onSubmit={search}><label>Check-in <input type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} required /></label><label>Check-out <input type="date" min={form.checkIn} value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} required /></label><label>Guests <input type="number" min="1" max="20" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} required /></label><button className="btn primary" disabled={loading}>{loading ? 'Searching...' : 'Search'}</button></form>
    <Notice error={error} />
    {rows && <DataTable cols={['Room', 'Floor', 'Room type', 'Capacity', 'Nightly price', 'Status']} rows={rows.map((room) => [`Room ${room.roomNumber}`, String(room.floor), room.roomTypeId?.name || '—', String(room.roomTypeId?.maxOccupancy || '—'), money(room.roomTypeId?.basePrice), room.status])} />}
    {rows && !rows.length && <p className="muted center-msg">No rooms are available for this stay.</p>}
  </>;
}
