import { useState } from 'react';
import { api, dateLabel, inputDate, money } from '../api/client.js';
import { DataTable, Field, Modal, Notice, PageHead, useApi } from '../ui.jsx';

const BEDS = ['King bed', 'Queen bed', '2 single beds', '2 queen beds'];

/* UC24 room types (add, edit, deactivate, delete when nothing is linked) and UC25 seasonal prices. */
export default function AdminRoomTypes() {
  const list = useApi('/room-types?limit=100');
  const [edit, setEdit] = useState(null); // {} = new
  const [pricing, setPricing] = useState(null);
  const [msg, setMsg] = useState(null);
  const done = (text) => { setMsg(text); list.reload(); };
  const toggle = async (t) => {
    try { await api(`/room-types/${t._id}`, { method: 'PATCH', body: { isActive: !t.isActive } }); done(`${t.name} ${t.isActive ? 'deactivated: it is hidden from guests and new bookings' : 'reactivated'}.`); }
    catch (x) { setMsg(null); alert(x.message); }
  };
  const remove = async (t) => {
    if (!confirm(`Delete room type "${t.name}"? Only a room type with no rooms, bookings, price rates or reviews can be deleted.`)) return;
    try { await api(`/room-types/${t._id}`, { method: 'DELETE' }); done(`${t.name} deleted.`); }
    catch (x) { setMsg(null); alert(x.message); }
  };
  return (
    <>
      <PageHead title="Room types" sub="Categories, capacity, amenities and base price. Seasonal rates override the base price for their dates." action="Add room type" onAction={() => setEdit({})} />
      <Notice error={list.error} ok={msg} />
      {list.loading ? <p className="muted">Loading…</p> : !list.data?.length ? <p className="empty">No room types yet.</p> : (
        <DataTable cols={['', 'Room type', 'Bed & guests', 'Base / night', 'Status', '']} rows={list.data.map((t) => [
          t.images?.[0] ? <img key="i" src={t.images[0]} alt="" width="64" height="44" style={{ objectFit: 'cover', borderRadius: 6, display: 'block' }} /> : <span key="i" className="img-ph" style={{ display: 'block', width: 64, height: 44, borderRadius: 6 }} />,
          <span key="n"><b>{t.name}</b>{t.description ? <small className="muted" style={{ display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</small> : null}</span>,
          <span key="b">{t.bedType || '—'}<small className="muted" style={{ display: 'block' }}>{t.maxOccupancy} guests{t.roomSizeSqm ? ` · ${t.roomSizeSqm} m²` : ''}</small></span>,
          <span key="p" style={{ whiteSpace: 'nowrap' }}>{money(t.basePrice)}<small className="muted" style={{ display: 'block' }}>{t.seasonalPricing?.length ? `+ ${t.seasonalPricing.length} seasonal rate${t.seasonalPricing.length > 1 ? 's' : ''}` : 'Base price only'}</small></span>,
          t.isActive ? 'active' : 'inactive',
          <span key="a" className="row-actions">
            <button className="btn sm" onClick={() => setEdit(t)}>Edit</button>
            <button className="btn sm" onClick={() => setPricing(t)}>Rates</button>
            <details className="rowmenu">
              <summary className="btn sm" aria-label="More actions">More ▾</summary>
              <div>
                <button onClick={(e) => { e.currentTarget.closest('details').open = false; toggle(t); }}>{t.isActive ? 'Deactivate' : 'Reactivate'}</button>
                <button className="danger" onClick={(e) => { e.currentTarget.closest('details').open = false; remove(t); }}>Delete</button>
              </div>
            </details>
          </span>,
        ])} />
      )}
      {edit && <RoomTypeForm type={edit} onClose={() => setEdit(null)} onSaved={(text) => { setEdit(null); done(text); }} />}
      {pricing && <SeasonalRates type={pricing} onClose={() => { setPricing(null); list.reload(); }} />}
    </>
  );
}

function RoomTypeForm({ type, onClose, onSaved }) {
  const isNew = !type._id;
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget));
    const body = {
      name: f.name.trim(), bedType: f.bedType, description: f.description.trim(),
      roomSizeSqm: Number(f.roomSizeSqm), maxOccupancy: Number(f.maxOccupancy), basePrice: Number(f.basePrice),
      amenities: f.amenities.split(',').map((a) => a.trim()).filter(Boolean),
      // the first image is the one entered here; other images already on the room type are kept
      images: [...(f.image.trim() ? [f.image.trim()] : []), ...(type.images || []).slice(1)],
    };
    setSaving(true); setError(null);
    try {
      await api(isNew ? '/room-types' : `/room-types/${type._id}`, { method: isNew ? 'POST' : 'PATCH', body });
      onSaved(`${body.name} ${isNew ? 'created' : 'saved'}.`);
    } catch (x) { setError(x); } finally { setSaving(false); }
  };
  const fe = error?.fields || {};
  return <Modal title={isNew ? 'Add room type' : `Edit ${type.name}`} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    <div className="full"><Field label="Name" error={fe.name}><input name="name" defaultValue={type.name} required maxLength={100} /></Field></div>
    <Field label="Bed" error={fe.bedType}><select name="bedType" defaultValue={type.bedType || 'King bed'}>{[...new Set([...BEDS, type.bedType].filter(Boolean))].map((b) => <option key={b}>{b}</option>)}</select></Field>
    <Field label="Size (m²)" error={fe.roomSizeSqm}><input name="roomSizeSqm" type="number" min="1" defaultValue={type.roomSizeSqm || 30} required /></Field>
    <Field label="Max guests" error={fe.maxOccupancy}><input name="maxOccupancy" type="number" min="1" max="10" defaultValue={type.maxOccupancy || 2} required /></Field>
    <Field label="Base price (VND / night)" error={fe.basePrice}><input name="basePrice" type="number" min="1000" step="1000" defaultValue={type.basePrice || ''} required /></Field>
    <div className="full"><Field label="Amenities (comma separated)" error={fe.amenities}><input name="amenities" defaultValue={(type.amenities || ['Free WiFi', 'Air conditioning']).join(', ')} /></Field></div>
    <div className="full"><Field label="Image URL" error={fe.images}><input name="image" type="url" defaultValue={type.images?.[0] || ''} placeholder="https://…" /></Field></div>
    <div className="full"><Field label="Description" error={fe.description}><textarea name="description" maxLength={5000} defaultValue={type.description || ''} /></Field></div>
    <div className="full"><Notice error={error} /></div>
    <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
  </form></Modal>;
}

// UC25: rates for date periods; overlapping rates are refused (MSG-60). Existing bookings keep their price (BR-35).
function SeasonalRates({ type, onClose }) {
  const [rates, setRates] = useState(type.seasonalPricing || []);
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [ok, setOk] = useState(null);
  const save = async (next, text) => {
    setSaving(true); setError(null); setOk(null);
    try {
      const res = await api(`/room-types/${type._id}/pricing`, { method: 'PUT', body: { seasonalPricing: next } });
      setRates(res.data.seasonalPricing); setOk(text); return true;
    } catch (x) { setError(x); return false; } finally { setSaving(false); }
  };
  const add = async (e) => {
    e.preventDefault(); const form = e.currentTarget; const f = Object.fromEntries(new FormData(form));
    const next = [...rates, { description: f.description.trim(), startDate: f.startDate, endDate: f.endDate, price: Number(f.price) }];
    if (await save(next, 'Rate added.')) form.reset();
  };
  const remove = (r) => confirm(`Delete the rate "${r.description || 'Custom'}"? Its dates go back to the base price; existing bookings keep their price.`)
    && save(rates.filter((x) => x !== r), 'Rate deleted.');
  return <Modal title={`Seasonal rates · ${type.name}`} onClose={onClose}>
    <p className="muted">Base price {money(type.basePrice)} / night applies on every date without a rate.</p>
    {rates.length ? <DataTable cols={['Rate', 'From', 'To', 'Price / night', '']} rows={rates.map((r, i) => [
      r.description || 'Custom', dateLabel(r.startDate), dateLabel(r.endDate), money(r.price),
      <button key={i} className="btn sm danger" disabled={saving} onClick={() => remove(r)}>Delete</button>,
    ])} /> : <p className="empty">No seasonal rates.</p>}
    <form className="form-grid" onSubmit={add} style={{ marginTop: '1rem' }}>
      <div className="full"><Field label="Rate name (e.g. Tet holiday, Summer 2027)"><input name="description" required maxLength={100} /></Field></div>
      <Field label="From"><input name="startDate" type="date" min={inputDate(new Date())} required /></Field>
      <Field label="To (included)"><input name="endDate" type="date" min={inputDate(new Date())} required /></Field>
      <Field label="Price (VND / night)"><input name="price" type="number" min="1000" step="1000" required /></Field>
      <div className="full"><Notice error={error} ok={ok} /></div>
      <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Add rate'}</button></div>
    </form>
  </Modal>;
}
