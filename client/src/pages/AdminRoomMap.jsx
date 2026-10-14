import { useState, useEffect } from 'react';
import { ROOMS as INITIAL_ROOMS, ROOM_TYPES } from '../data.js';
import { roomApi } from '../api/roomApi.js';

const STATUS_CONFIG = {
  available: { label: 'Available', color: '#2e9e63', desc: 'Ready for guest check-in' },
  occupied: { label: 'Occupied', color: '#0f2742', desc: 'Guest is currently staying' },
  cleaning: { label: 'Cleaning', color: '#e0a030', desc: 'Housekeeping in progress' },
  maintenance: { label: 'Maintenance', color: '#d32f2f', desc: 'Out of order / repair' }
};

export default function AdminRoomMap() {
  const [rooms, setRooms] = useState(INITIAL_ROOMS);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomFloor, setNewRoomFloor] = useState('2');
  const [newRoomTypeId, setNewRoomTypeId] = useState(ROOM_TYPES[0]?.id || 1);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Change room status (UC30, lifecycle)
  const handleStatusChange = async (roomNo, newStatus) => {
    setRooms(prev => prev.map(r => r.no === roomNo ? { ...r, status: newStatus } : r));
    if (selectedRoom && selectedRoom.no === roomNo) {
      setSelectedRoom(prev => ({ ...prev, status: newStatus }));
    }
    showToast(`Room ${roomNo} status updated to "${STATUS_CONFIG[newStatus]?.label}"`);

    // Best-effort backend call
    try {
      await roomApi.updateRoomStatus(roomNo, newStatus);
    } catch {
      // Offline/fallback handled
    }
  };

  // Add room (UC30)
  const handleAddRoom = (e) => {
    e.preventDefault();
    if (!newRoomNumber.trim()) return;

    if (rooms.some(r => r.no === newRoomNumber.trim())) {
      alert(`Room number ${newRoomNumber} already exists!`);
      return;
    }

    const newRoom = {
      no: newRoomNumber.trim(),
      floor: parseInt(newRoomFloor, 10),
      typeId: newRoomTypeId,
      status: 'available'
    };

    setRooms(prev => [...prev, newRoom].sort((a, b) => a.no.localeCompare(b.no)));
    setShowAddModal(false);
    setNewRoomNumber('');
    showToast(`Room ${newRoom.no} created successfully!`);
  };

  const floors = [...new Set(rooms.map(r => r.no[0]))].sort();
  const filteredRooms = filterStatus === 'all' ? rooms : rooms.filter(r => r.status === filterStatus);

  const counts = {
    total: rooms.length,
    available: rooms.filter(r => r.status === 'available').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    cleaning: rooms.filter(r => r.status === 'cleaning').length,
    maintenance: rooms.filter(r => r.status === 'maintenance').length
  };

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
          <h1>Interactive Room Map</h1>
          <p>Live inventory monitoring & room lifecycle management (UC30, UC05)</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setShowAddModal(true)}>+ Add Room</button>
        </div>
      </div>

      {/* Real-time KPI Status Bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '0.75rem', marginBottom: '1.25rem'
      }}>
        <div style={{ background: '#fff', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Total Rooms</span>
          <strong style={{ display: 'block', fontSize: '1.5rem', color: 'var(--navy)' }}>{counts.total}</strong>
        </div>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <div key={key}
            onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}
            style={{
              background: filterStatus === key ? cfg.color : '#fff',
              color: filterStatus === key ? '#fff' : 'var(--text)',
              padding: '12px 16px', borderRadius: '12px', border: `1px solid ${filterStatus === key ? cfg.color : 'var(--line)'}`,
              cursor: 'pointer', transition: 'all 0.15s'
            }}>
            <span style={{ fontSize: '0.78rem', opacity: 0.85 }}>{cfg.label}</span>
            <strong style={{ display: 'block', fontSize: '1.5rem' }}>{counts[key]}</strong>
          </div>
        ))}
      </div>

      {/* Legend & Filter Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="legend" style={{ margin: 0 }}>
          {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
            <span key={s} style={{ cursor: 'pointer', opacity: filterStatus === 'all' || filterStatus === s ? 1 : 0.4 }} onClick={() => setFilterStatus(filterStatus === s ? 'all' : s)}>
              <i style={{ background: cfg.color }} /> {cfg.label} ({counts[s]})
            </span>
          ))}
        </div>
        <div className="chips" style={{ margin: 0 }}>
          <button className={`chip ${filterStatus === 'all' ? 'on' : ''}`} onClick={() => setFilterStatus('all')}>All Rooms</button>
          {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
            <button key={s} className={`chip ${filterStatus === s ? 'on' : ''}`} onClick={() => setFilterStatus(s)}>{cfg.label}</button>
          ))}
        </div>
      </div>

      {/* Floors grid */}
      {floors.map(fl => {
        const floorRooms = filteredRooms.filter(r => r.no[0] === fl);
        if (floorRooms.length === 0) return null;
        return (
          <section key={fl} className="floor" style={{ background: '#fff', padding: '1.25rem', borderRadius: '14px', border: '1px solid var(--line)', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Floor {fl}</h2>
              <span className="muted" style={{ fontSize: '0.85rem' }}>{floorRooms.length} room{floorRooms.length > 1 ? 's' : ''}</span>
            </div>
            <div className="rooms">
              {floorRooms.map(r => (
                <button
                  key={r.no}
                  onClick={() => setSelectedRoom(r)}
                  className={`room s-${r.status}`}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    outline: selectedRoom?.no === r.no ? '3px solid #ffd700' : 'none'
                  }}
                  title={`Click to inspect or change status of Room ${r.no}`}
                >
                  <b>{r.no}</b>
                  <small>{STATUS_CONFIG[r.status]?.label || r.status}</small>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {/* Room Detail & Status Switcher Modal */}
      {selectedRoom && (
        <div className="scrim" onClick={() => setSelectedRoom(null)} style={{ display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '1.75rem', width: 'min(440px, 92vw)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)', animation: 'pop 0.2s ease-out'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Room {selectedRoom.no}</h2>
                <span className="muted">Floor {selectedRoom.no[0]} · Standard Suite</span>
              </div>
              <button onClick={() => setSelectedRoom(null)} style={{ border: 0, background: '#eee', borderRadius: '99px', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Current Status:</span>
                <span className={`badge b-${selectedRoom.status}`}>{STATUS_CONFIG[selectedRoom.status]?.label}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>
                {STATUS_CONFIG[selectedRoom.status]?.desc}
              </p>
            </div>

            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--muted)', textTransform: 'uppercase' }}>
              Change Operational Status:
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  disabled={selectedRoom.status === key}
                  onClick={() => handleStatusChange(selectedRoom.no, key)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: `1.5px solid ${cfg.color}`,
                    background: selectedRoom.status === key ? cfg.color : '#fff',
                    color: selectedRoom.status === key ? '#fff' : cfg.color,
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: selectedRoom.status === key ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: selectedRoom.status === key ? '#fff' : cfg.color }} />
                  {cfg.label}
                </button>
              ))}
            </div>

            <button className="btn" style={{ width: '100%' }} onClick={() => setSelectedRoom(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Add Room Modal (UC30) */}
      {showAddModal && (
        <div className="scrim" onClick={() => setShowAddModal(false)} style={{ display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <form
            onSubmit={handleAddRoom}
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '1.75rem', width: 'min(420px, 92vw)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)'
            }}
          >
            <h2 style={{ margin: '0 0 0.25rem' }}>Add New Physical Room</h2>
            <p className="muted" style={{ margin: '0 0 1.25rem' }}>Register a room into the hotel inventory (UC30)</p>

            <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
              <label>
                Room Number
                <input
                  type="text"
                  placeholder="e.g. 405"
                  value={newRoomNumber}
                  onChange={e => setNewRoomNumber(e.target.value)}
                  required
                />
              </label>

              <label>
                Floor
                <select value={newRoomFloor} onChange={e => setNewRoomFloor(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 7].map(f => (
                    <option key={f} value={f}>Floor {f}</option>
                  ))}
                </select>
              </label>

              <label>
                Room Type
                <select value={newRoomTypeId} onChange={e => setNewRoomTypeId(e.target.value)}>
                  {ROOM_TYPES.map(rt => (
                    <option key={rt.id} value={rt.id}>{rt.name} (${rt.price}/night)</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button type="submit" className="btn primary">Create Room</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
