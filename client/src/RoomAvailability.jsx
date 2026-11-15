import { useEffect, useState } from 'react';
import { useAuth } from './context/Auth.jsx';
import { money } from './api/client.js';
import { DataTable, Notice, PageHead, Screen, useApi } from './ui.jsx';

const day = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 864e5));
const PAGE = 10;
export default function RoomAvailability() {
  const { user } = useAuth();
  const canFilter = user.permissions.includes('rooms.filter');
  const [selected, setSelected] = useState(null);
  const detail = useApi(selected ? `/rooms/${selected}` : null);
  const [form, setForm] = useState({ checkIn: day(0), checkOut: day(1), guests: '1' });
  const [type, setType] = useState(''); const [floor, setFloor] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const query = new URLSearchParams({ checkIn: form.checkIn, checkOut: form.checkOut, ...(canFilter ? { guests: form.guests } : {}) });
  const result = useApi(`/rooms/search?${query}`, Boolean(form.checkIn && form.checkOut > form.checkIn));
  const { data: rows, error, loading } = result;
  const search = (event) => { event.preventDefault(); result.reload(); };
  useEffect(() => setPage(1), [type, floor, q, rows]);
  const types = [...new Set((rows || []).map((r) => r.roomTypeId?.name).filter(Boolean))].sort();
  const floors = [...new Set((rows || []).map((r) => r.floor))].sort((a, b) => a - b);
  const shown = (rows || []).filter((r) => (!type || r.roomTypeId?.name === type) && (!floor || String(r.floor) === floor) && String(r.roomNumber).toLowerCase().includes(q.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE)); const slice = shown.slice((page - 1) * PAGE, page * PAGE);
  if (selected) return <Screen title="Room details" onClose={() => setSelected(null)}><Notice error={detail.error} />
    {detail.data ? <><h2>Room {detail.data.roomNumber}</h2><p>Floor {detail.data.floor} · {detail.data.roomTypeId?.name} · {detail.data.status}</p><p>{detail.data.description || 'No additional description.'}</p></> : detail.loading && <p>Loading…</p>}
  </Screen>;
  return <><PageHead title="Room availability" sub="Check available physical rooms for a guest's stay before creating or modifying a front-desk booking." />
    <form className="chips" onSubmit={search}><label>Check-in <input type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} required /></label><label>Check-out <input type="date" min={form.checkIn} value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} required /></label>{canFilter && <label>Guests <input type="number" min="1" max="100" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} required /></label>}<button className="btn primary" disabled={loading}>{loading ? 'Searching...' : 'Search'}</button></form>
    <Notice error={error} />
    {canFilter && rows && !!rows.length && <div className="chips"><input type="search" placeholder="Room number" aria-label="Room number" value={q} onChange={(e) => setQ(e.target.value)} />
      <select aria-label="Room type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All room types</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
      <select aria-label="Floor" value={floor} onChange={(e) => setFloor(e.target.value)}><option value="">All floors</option>{floors.map((f) => <option key={f} value={f}>Floor {f}</option>)}</select></div>}
    {rows && !!slice.length && <DataTable cols={['Room', 'Floor', 'Room type', 'Capacity', 'Nightly price', 'Status', '']} rows={slice.map((room) => [`Room ${room.roomNumber}`, String(room.floor), room.roomTypeId?.name || '—', String(room.roomTypeId?.maxOccupancy || '—'), money(room.roomTypeId?.basePrice), room.status, user.permissions.includes('rooms.details.read') ? <button className="btn sm" onClick={() => setSelected(room._id)}>Details</button> : ''])} />}
    {rows && !!rows.length && !shown.length && <p className="muted center-msg">No rooms match these filters.</p>}
    {rows && !rows.length && <p className="muted center-msg">No rooms are available for this stay.</p>}
    {rows && shown.length > PAGE && <div className="between" style={{ marginTop: '1rem' }}>
      <span className="muted">{shown.length} rooms · page {page} of {pages}</span>
      <span className="row-actions"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></span>
    </div>}
  </>;
}
