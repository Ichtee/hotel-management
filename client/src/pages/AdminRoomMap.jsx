import { useState, useEffect } from 'react';
import { roomApi } from '../api/roomApi.js';
import { Screen, WaitScreen, useScreen } from '../ui.jsx';

const STATUS_CONFIG = {
  available: { label: 'Available', color: '#1f7a4c', desc: 'Ready for guest check-in' },
  occupied: { label: 'Occupied', color: '#0f2742', desc: 'Guest is currently staying' },
  cleaning: { label: 'Cleaning', color: '#e0a030', desc: 'Housekeeping in progress' },
  maintenance: { label: 'Maintenance', color: '#d32f2f', desc: 'Out of order / repair' }
};

export default function AdminRoomMap() {
  const [rooms, setRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const sc = useScreen();
  const selectedRoom = sc.name === 'room' ? rooms.find((r) => r._id === sc.id) : null;
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomFloor, setNewRoomFloor] = useState('');
  const [newRoomTypeId, setNewRoomTypeId] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [roomsRes, typesRes] = await Promise.allSettled([
        roomApi.getRooms({ limit: 100 }), // the API pages by 10 by default
        roomApi.getRoomTypes()
      ]);

      if (typesRes.status === 'fulfilled') {
        const rawTypes = Array.isArray(typesRes.value) ? typesRes.value : (typesRes.value?.data || []);
        if (rawTypes.length > 0) {
          setRoomTypes(rawTypes.map(t => ({
            id: t._id || t.id,
            _id: t._id || t.id,
            name: t.name,
            price: t.basePrice
          })));
          setNewRoomTypeId(rawTypes[0]._id || rawTypes[0].id);
        }
      }

      if (roomsRes.status === 'fulfilled') {
        const rawRooms = Array.isArray(roomsRes.value) ? roomsRes.value : (roomsRes.value?.data || []);
        {
          const mapped = rawRooms.filter(r => r.isActive !== false).map(r => ({
            _id: r._id || r.id,
            no: r.roomNumber || r.no,
            floor: r.floor,
            status: r.status || 'available',
            typeName: r.roomTypeId?.name || '',
            roomTypeId: r.roomTypeId?._id || r.roomTypeId
          })).sort((a, b) => a.no.localeCompare(b.no));
          setRooms(mapped);
        }
      }
    } catch (err) {
      console.warn('Error loading room map data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Change room status (UC30, lifecycle)
  const handleStatusChange = async (targetRoom, newStatus) => {
    const roomKey = targetRoom._id || targetRoom.no;
    if (newStatus !== 'maintenance' && targetRoom.status !== 'maintenance') {
      alert('Occupied, cleaning and available follow check-in, check-out and housekeeping. You can only put a room into Maintenance or take it out.');
      return;
    }
    try {
      const res = await roomApi.updateRoomStatus(roomKey, newStatus);
      const saved = res?.data?.status || newStatus;
      setRooms(prev => prev.map(r => (r._id === roomKey || r.no === targetRoom.no) ? { ...r, status: saved } : r));
      showToast(`Room ${targetRoom.no} is now "${STATUS_CONFIG[saved]?.label || saved}"`);
    } catch (err) {
      alert(err.message);
    }
  };

  // Add room (UC30)
  const handleAddRoom = async (e) => {
    e.preventDefault();
    const trimmedNo = newRoomNumber.trim();
    if (!trimmedNo) return;

    if (rooms.some(r => r.no === trimmedNo)) {
      alert(`Room ${trimmedNo} already exists.`);
      return;
    }

    const payload = {
      roomNumber: trimmedNo,
      floor: parseInt(newRoomFloor, 10),
      roomTypeId: newRoomTypeId || roomTypes[0]?.id || roomTypes[0]?._id,
      status: 'available'
    };

    try {
      await roomApi.createRoom(payload);
      showToast(`Room ${payload.roomNumber} created`);
      sc.close();
      setNewRoomNumber('');
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Delete room (UC30)
  const handleDeleteRoom = async (targetRoom) => {
    if (!window.confirm(`Deactivate room ${targetRoom.no}? It will no longer be sold; past bookings keep it.`)) return;
    try {
      if (targetRoom._id) {
        await roomApi.deleteRoom(targetRoom._id);
      }
      setRooms(prev => prev.filter(r => r.no !== targetRoom.no));
      sc.close();
      showToast(`Room ${targetRoom.no} deactivated`);
    } catch (err) {
      alert(err.message);
    }
  };

  const floors = [...new Set(rooms.map(r => String(r.floor ?? '?')))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const filteredRooms = filterStatus === 'all' ? rooms : rooms.filter(r => r.status === filterStatus);

  const counts = {
    total: rooms.length,
    available: rooms.filter(r => r.status === 'available').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    cleaning: rooms.filter(r => r.status === 'cleaning').length,
    maintenance: rooms.filter(r => r.status === 'maintenance').length
  };

  if (sc.name === 'room') return selectedRoom ? (
        <Screen title={`Room ${selectedRoom.no}`} onClose={sc.close}>
          <p className="muted" style={{ marginTop: 0 }}>Floor {selectedRoom.floor}{selectedRoom.typeName ? ` · ${selectedRoom.typeName}` : ''}</p>
          <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span className="muted">Current status</span>
              <span className={`badge b-${selectedRoom.status}`}>{STATUS_CONFIG[selectedRoom.status]?.label}</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>{STATUS_CONFIG[selectedRoom.status]?.desc}</p>
          </div>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Change status</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                disabled={selectedRoom.status === key}
                onClick={() => handleStatusChange(selectedRoom, key)}
                style={{
                  minHeight: 44, padding: '10px 12px', borderRadius: '8px', border: `1.5px solid ${cfg.color}`,
                  background: selectedRoom.status === key ? cfg.color : '#fff', color: selectedRoom.status === key ? '#fff' : cfg.color,
                  fontWeight: 600, cursor: selectedRoom.status === key ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: selectedRoom.status === key ? '#fff' : cfg.color }} />
                {cfg.label}
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn danger" onClick={() => handleDeleteRoom(selectedRoom)}>Deactivate room</button>
            <button className="btn primary" onClick={sc.close}>Done</button>
          </div>
        </Screen>
  ) : <WaitScreen loading={loading} onClose={sc.close} />;
  if (sc.name === 'new') return (
        <Screen title="Add room" onClose={sc.close}>
          <form onSubmit={handleAddRoom} className="form">
            <p className="muted" style={{ marginTop: 0 }}>A new room starts as Available.</p>
            <label>
              Room number
              <input type="text" placeholder="e.g. 305" value={newRoomNumber} onChange={e => setNewRoomNumber(e.target.value)} required />
            </label>
            <label>
              Floor
              <input type="number" min="0" step="1" required placeholder="e.g. 3" value={newRoomFloor} onChange={e => setNewRoomFloor(e.target.value)} />
            </label>
            <label>
              Room type
              <select value={newRoomTypeId} onChange={e => setNewRoomTypeId(e.target.value)}>
                {roomTypes.map(rt => <option key={rt.id || rt._id} value={rt.id || rt._id}>{rt.name}</option>)}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={sc.close}>Cancel</button>
              <button type="submit" className="btn primary">Create room</button>
            </div>
          </form>
        </Screen>
  );
  return (
    <div className="room-map-page">
      {toastMessage && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
          background: '#0f2742', color: '#fff', padding: '12px 20px', borderRadius: '10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)', fontSize: '0.9rem', fontWeight: 600
        }}>
          ✓ {toastMessage}
        </div>
      )}

      <div className="page-head">
        <div>
          <h1>Room map</h1>
          <p>Live status of every room. Put a room into Maintenance, add or deactivate rooms.</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => sc.go('new')}>+ Add room</button>
        </div>
      </div>

      {/* One row of filters: each count is a button, its dot is the colour key of the map (no colour-only meaning: the label is there too). */}
      <div className="room-filters" role="group" aria-label="Filter rooms by status">
        <button type="button" className={`room-filter ${filterStatus === 'all' ? 'on' : ''}`} aria-pressed={filterStatus === 'all'} onClick={() => setFilterStatus('all')}>
          <span>All rooms</span><strong>{counts.total}</strong>
        </button>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button key={key} type="button" className={`room-filter ${filterStatus === key ? 'on' : ''}`} aria-pressed={filterStatus === key} onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}>
            <span><i className={`dot s-${key}`} aria-hidden="true" />{cfg.label}</span><strong>{counts[key]}</strong>
          </button>
        ))}
      </div>

      {/* Floors grid */}
      {floors.map(fl => {
        const floorRooms = filteredRooms.filter(r => String(r.floor ?? '?') === fl);
        if (floorRooms.length === 0) return null;
        return (
          <section key={fl} className="floor" style={{ background: '#fff', padding: '1.25rem', borderRadius: '14px', border: '1px solid var(--line)', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Floor {fl}</h2>
              <span className="muted" style={{ fontSize: '0.85rem' }}>{floorRooms.length} room{floorRooms.length === 1 ? "" : "s"}</span>
            </div>
            <div className="rooms">
              {floorRooms.map(r => (
                <button
                  key={r.no}
                  onClick={() => sc.go('room', r._id)}
                  className={`room s-${r.status}`}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    outline: selectedRoom?.no === r.no ? '3px solid #ffd700' : 'none'
                  }}
                  title={`Room ${r.no} (${STATUS_CONFIG[r.status]?.label})`}
                >
                  <b>{r.no}</b>
                  <small>{STATUS_CONFIG[r.status]?.label || r.status}</small>
                </button>
              ))}
            </div>
          </section>
        );
      })}

    </div>
  );
}
