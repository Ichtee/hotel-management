import { useState, useEffect } from 'react';
import { ROOMS as INITIAL_ROOMS, ROOM_TYPES as STATIC_ROOM_TYPES } from '../data.js';
import { roomApi } from '../api/roomApi.js';

const STATUS_CONFIG = {
  available: { label: 'Available', color: '#2e9e63', desc: 'Ready for guest check-in' },
  occupied: { label: 'Occupied', color: '#0f2742', desc: 'Guest is currently staying' },
  cleaning: { label: 'Cleaning', color: '#e0a030', desc: 'Housekeeping in progress' },
  maintenance: { label: 'Maintenance', color: '#d32f2f', desc: 'Out of order / repair' }
};

export default function AdminRoomMap() {
  const [rooms, setRooms] = useState(INITIAL_ROOMS);
  const [roomTypes, setRoomTypes] = useState(STATIC_ROOM_TYPES);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomFloor, setNewRoomFloor] = useState('2');
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
        roomApi.getRooms(),
        roomApi.getRoomTypes()
      ]);

      if (typesRes.status === 'fulfilled') {
        const rawTypes = Array.isArray(typesRes.value) ? typesRes.value : (typesRes.value?.data || []);
        if (rawTypes.length > 0) {
          setRoomTypes(rawTypes.map(t => ({
            id: t._id || t.id,
            _id: t._id || t.id,
            name: t.name,
            price: t.basePrice || t.price || 80
          })));
          setNewRoomTypeId(rawTypes[0]._id || rawTypes[0].id);
        }
      }

      if (roomsRes.status === 'fulfilled') {
        const rawRooms = Array.isArray(roomsRes.value) ? roomsRes.value : (roomsRes.value?.data || []);
        if (rawRooms.length > 0) {
          const mapped = rawRooms.map(r => ({
            _id: r._id || r.id,
            no: r.roomNumber || r.no,
            floor: r.floor || (r.roomNumber ? parseInt(r.roomNumber[0], 10) : 1),
            status: r.status || 'available',
            typeName: r.roomTypeId?.name || 'Standard Room',
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
    setRooms(prev => prev.map(r => (r._id === roomKey || r.no === targetRoom.no) ? { ...r, status: newStatus } : r));
    if (selectedRoom && (selectedRoom._id === roomKey || selectedRoom.no === targetRoom.no)) {
      setSelectedRoom(prev => ({ ...prev, status: newStatus }));
    }
    showToast(`Room ${targetRoom.no} status updated to "${STATUS_CONFIG[newStatus]?.label}"`);

    try {
      await roomApi.updateRoomStatus(roomKey, newStatus);
    } catch (err) {
      console.warn('Backend updateRoomStatus failed, kept local state:', err);
    }
  };

  // Add room (UC30)
  const handleAddRoom = async (e) => {
    e.preventDefault();
    const trimmedNo = newRoomNumber.trim();
    if (!trimmedNo) return;

    if (rooms.some(r => r.no === trimmedNo)) {
      alert(`Phòng số ${trimmedNo} đã tồn tại!`);
      return;
    }

    const payload = {
      roomNumber: trimmedNo,
      floor: parseInt(newRoomFloor, 10) || 1,
      roomTypeId: newRoomTypeId || roomTypes[0]?.id || roomTypes[0]?._id,
      status: 'available'
    };

    try {
      await roomApi.createRoom(payload);
      showToast(`Phòng ${payload.roomNumber} đã được tạo thành công!`);
      setShowAddModal(false);
      setNewRoomNumber('');
      loadData();
    } catch (err) {
      alert(`Lỗi khi tạo phòng: ${err.message}`);
    }
  };

  // Delete room (UC30)
  const handleDeleteRoom = async (targetRoom) => {
    if (!window.confirm(`Bạn có chắc muốn xóa phòng ${targetRoom.no}?`)) return;
    try {
      if (targetRoom._id) {
        await roomApi.deleteRoom(targetRoom._id);
      }
      setRooms(prev => prev.filter(r => r.no !== targetRoom.no));
      setSelectedRoom(null);
      showToast(`Đã xóa phòng ${targetRoom.no}`);
    } catch (err) {
      alert(`Lỗi khi xóa phòng: ${err.message}`);
    }
  };

  const floors = [...new Set(rooms.map(r => String(r.no)[0]))].sort();
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
          <h1>Sơ Đồ Phòng Trực Quan (Interactive Room Map)</h1>
          <p>Giám sát tình trạng phòng theo thời gian thực và quản lý vòng đời phòng (UC30, UC05)</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setShowAddModal(true)}>+ Thêm Phòng Mới</button>
        </div>
      </div>

      {/* Real-time KPI Status Bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '0.75rem', marginBottom: '1.25rem'
      }}>
        <div style={{ background: '#fff', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Tổng số phòng</span>
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
          <button className={`chip ${filterStatus === 'all' ? 'on' : ''}`} onClick={() => setFilterStatus('all')}>Tất cả</button>
          {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
            <button key={s} className={`chip ${filterStatus === s ? 'on' : ''}`} onClick={() => setFilterStatus(s)}>{cfg.label}</button>
          ))}
        </div>
      </div>

      {/* Floors grid */}
      {floors.map(fl => {
        const floorRooms = filteredRooms.filter(r => String(r.no)[0] === fl);
        if (floorRooms.length === 0) return null;
        return (
          <section key={fl} className="floor" style={{ background: '#fff', padding: '1.25rem', borderRadius: '14px', border: '1px solid var(--line)', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Tầng {fl}</h2>
              <span className="muted" style={{ fontSize: '0.85rem' }}>{floorRooms.length} phòng</span>
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
                  title={`Phòng ${r.no} (${STATUS_CONFIG[r.status]?.label})`}
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
                <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Phòng {selectedRoom.no}</h2>
                <span className="muted">Tầng {String(selectedRoom.no)[0]} · {selectedRoom.typeName || 'Standard Room'}</span>
              </div>
              <button onClick={() => setSelectedRoom(null)} style={{ border: 0, background: '#eee', borderRadius: '99px', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Trạng thái hiện tại:</span>
                <span className={`badge b-${selectedRoom.status}`}>{STATUS_CONFIG[selectedRoom.status]?.label}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>
                {STATUS_CONFIG[selectedRoom.status]?.desc}
              </p>
            </div>

            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--muted)', textTransform: 'uppercase' }}>
              Chuyển Trạng Thái Vận Hành:
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  disabled={selectedRoom.status === key}
                  onClick={() => handleStatusChange(selectedRoom, key)}
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

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn"
                style={{ color: 'var(--red)', borderColor: 'var(--red)', fontSize: '0.85rem' }}
                onClick={() => handleDeleteRoom(selectedRoom)}
              >
                Xóa phòng này
              </button>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => setSelectedRoom(null)}>
                Đóng
              </button>
            </div>
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
            <h2 style={{ margin: '0 0 0.25rem' }}>Thêm Phòng Vật Lý Mới</h2>
            <p className="muted" style={{ margin: '0 0 1.25rem' }}>Đăng ký phòng vào sơ đồ khách sạn (UC30)</p>

            <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
              <label>
                Số Phòng
                <input
                  type="text"
                  placeholder="Ví dụ: 305, 401..."
                  value={newRoomNumber}
                  onChange={e => setNewRoomNumber(e.target.value)}
                  required
                />
              </label>

              <label>
                Tầng
                <select value={newRoomFloor} onChange={e => setNewRoomFloor(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 7].map(f => (
                    <option key={f} value={f}>Tầng {f}</option>
                  ))}
                </select>
              </label>

              <label>
                Hạng Phòng
                <select value={newRoomTypeId} onChange={e => setNewRoomTypeId(e.target.value)}>
                  {roomTypes.map(rt => (
                    <option key={rt.id || rt._id} value={rt.id || rt._id}>
                      {rt.name} (${rt.price}/đêm)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setShowAddModal(false)}>Hủy</button>
              <button type="submit" className="btn primary">Tạo Phòng Mới</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
