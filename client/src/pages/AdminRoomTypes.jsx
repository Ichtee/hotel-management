import { useEffect, useState } from 'react';
import { roomApi } from '../api/roomApi.js';

// Helper: map MongoDB room-type document to the shape used by the UI
function mapRoomType(rt) {
  return {
    id: rt._id || rt.id,
    _id: rt._id || rt.id,
    name: rt.name,
    bed: rt.bedType || 'King bed',
    size: rt.roomSizeSqm || 30,
    guests: rt.maxOccupancy || 2,
    price: rt.basePrice || rt.price || 80,
    rating: rt.rating || 5.0,
    desc: rt.description || '',
    amenities: rt.amenities || ['Free WiFi', 'Air conditioning'],
    img: rt.images?.[0] || 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=70',
    seasonalPricing: rt.seasonalPricing || []
  };
}

export default function AdminRoomTypes() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSeasonal, setEditingSeasonal] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

  // Form states for adding room type
  const [name, setName] = useState('');
  const [bed, setBed] = useState('King bed');
  const [size, setSize] = useState('35');
  const [guests, setGuests] = useState('2');
  const [price, setPrice] = useState('95');
  const [desc, setDesc] = useState('');

  // Seasonal rates state for currently edited room type
  const [seasonName, setSeasonName] = useState('');
  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [seasonPrice, setSeasonPrice] = useState('');
  const [seasonSaving, setSeasonSaving] = useState(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Load room types from MongoDB on mount
  const loadTypes = () => {
    setLoading(true);
    setErrorMsg('');
    roomApi.getRoomTypes()
      .then((data) => {
        // API may return { data: [...] } or directly an array
        const list = Array.isArray(data) ? data : (data?.data || data?.roomTypes || []);
        setTypes(list.map(mapRoomType));
      })
      .catch((err) => {
        setErrorMsg(`Không thể tải danh sách loại phòng: ${err.message}`);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTypes(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    const payload = {
      name: name.trim(),
      bedType: bed,
      roomSizeSqm: parseInt(size, 10) || 30,
      maxOccupancy: parseInt(guests, 10) || 2,
      basePrice: parseFloat(price) || 80,
      description: desc.trim() || 'A comfortable modern guest room.',
      amenities: ['Free WiFi', 'Air conditioning'],
      images: ['https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=70'],
      seasonalPricing: []
    };

    try {
      await roomApi.createRoomType(payload);
      showToast(`Hạng phòng "${payload.name}" đã được tạo thành công!`);
      setShowAddModal(false);
      setName('');
      setDesc('');
      loadTypes(); // Reload from DB
    } catch (err) {
      alert(`Lỗi khi tạo hạng phòng: ${err.message}`);
    }
  };

  const handleDelete = async (id, typeName) => {
    if (!window.confirm(`Bạn có chắc muốn xóa hạng phòng "${typeName}"?`)) return;
    try {
      await roomApi.deleteRoomType(id);
      showToast(`Đã xóa hạng phòng "${typeName}"`);
      loadTypes(); // Reload from DB
    } catch (err) {
      alert(`Lỗi khi xóa: ${err.message}`);
    }
  };

  const handleAddSeason = async (e) => {
    e.preventDefault();
    if (!seasonName || !seasonStart || !seasonEnd || !seasonPrice) return;

    if (new Date(seasonEnd) <= new Date(seasonStart)) {
      alert('Ngày kết thúc phải sau ngày bắt đầu!');
      return;
    }

    const newSeason = {
      seasonName,
      startDate: seasonStart,
      endDate: seasonEnd,
      price: parseFloat(seasonPrice)
    };

    const currentSeasons = editingSeasonal.seasonalPricing || [];
    const updatedSeasons = [...currentSeasons, newSeason];

    setSeasonSaving(true);
    try {
      await roomApi.updatePricing(editingSeasonal._id || editingSeasonal.id, { seasonalPricing: updatedSeasons });
      showToast(`Đã thêm giá mùa "${seasonName}" cho ${editingSeasonal.name}!`);
      setSeasonName('');
      setSeasonStart('');
      setSeasonEnd('');
      setSeasonPrice('');
      // Reload and re-open the season modal with updated data
      await roomApi.getRoomTypes()
        .then((data) => {
          const list = Array.isArray(data) ? data : (data?.data || data?.roomTypes || []);
          const mapped = list.map(mapRoomType);
          setTypes(mapped);
          // Refresh the editingSeasonal reference so new seasons appear immediately
          const updated = mapped.find((t) => (t._id || t.id) === (editingSeasonal._id || editingSeasonal.id));
          if (updated) setEditingSeasonal(updated);
        });
    } catch (err) {
      alert(`Lỗi khi lưu giá mùa: ${err.message}`);
    } finally {
      setSeasonSaving(false);
    }
  };

  return (
    <div className="admin-roomtypes-page">
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
          <h1>Quản lý Loại Phòng &amp; Giá (Room Types)</h1>
          <p>Thiết lập danh mục hạng phòng, sức chứa, tiện nghi và giá mùa cao điểm (UC31, UC32)</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setShowAddModal(true)}>+ Thêm Hạng Phòng</button>
        </div>
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #fca5a5' }}>
          {errorMsg} — <button className="btn" style={{ padding: '2px 10px', fontSize: '0.8rem' }} onClick={loadTypes}>Thử lại</button>
        </div>
      )}

      {/* Room Types Cards & Table */}
      <div className="table-wrap" style={{ background: '#fff', borderRadius: '14px', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Hình ảnh</th>
              <th>Tên hạng phòng</th>
              <th>Giường</th>
              <th>Diện tích</th>
              <th>Sức chứa</th>
              <th>Giá gốc (Base)</th>
              <th>Giá mùa vụ (Seasonal)</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Đang tải dữ liệu…</td></tr>
            ) : types.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Chưa có hạng phòng nào. Bấm "+ Thêm Hạng Phòng" để tạo mới.</td></tr>
            ) : types.map(t => (
              <tr key={t.id}>
                <td>
                  <img src={t.img} alt={t.name} style={{ width: '64px', height: '44px', objectFit: 'cover', borderRadius: '6px' }} />
                </td>
                <td>
                  <strong>{t.name}</strong>
                  <div className="muted" style={{ fontSize: '0.78rem' }}>{t.desc ? t.desc.slice(0, 45) + '...' : ''}</div>
                </td>
                <td>{t.bed}</td>
                <td>{t.size} m²</td>
                <td>{t.guests} khách</td>
                <td>
                  <strong style={{ color: 'var(--green)', fontSize: '1.05rem' }}>${t.price}</strong>
                  <span className="muted" style={{ fontSize: '0.75rem' }}> /đêm</span>
                </td>
                <td>
                  {t.seasonalPricing && t.seasonalPricing.length > 0 ? (
                    <span className="badge b-in_progress" title={`${t.seasonalPricing.length} đợt giá mùa`}>
                      {t.seasonalPricing.length} đợt điều chỉnh
                    </span>
                  ) : (
                    <span className="badge b-low">Giá tiêu chuẩn</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      onClick={() => setEditingSeasonal(t)}
                    >
                      Quản lý giá mùa
                    </button>
                    <button
                      className="btn"
                      style={{ padding: '6px 10px', fontSize: '0.8rem', color: 'var(--red)', borderColor: 'var(--red)' }}
                      onClick={() => handleDelete(t._id || t.id, t.name)}
                    >
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Room Type Modal (UC31) */}
      {showAddModal && (
        <div className="scrim" onClick={() => setShowAddModal(false)} style={{ display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <form
            onSubmit={handleCreate}
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '1.75rem', width: 'min(500px, 92vw)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto'
            }}
          >
            <h2 style={{ margin: '0 0 0.25rem' }}>Thêm Hạng Phòng Mới</h2>
            <p className="muted" style={{ margin: '0 0 1.25rem' }}>Tạo hạng phòng lưu trú mới trong khách sạn (UC31)</p>

            <div style={{ display: 'grid', gap: '0.9rem', marginBottom: '1.5rem' }}>
              <label>
                Tên Hạng Phòng
                <input
                  type="text"
                  placeholder="Ví dụ: Executive Suite Ocean View"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label>
                  Loại Giường
                  <select value={bed} onChange={e => setBed(e.target.value)}>
                    <option value="King bed">1 Giường King</option>
                    <option value="Queen bed">1 Giường Queen</option>
                    <option value="2 single beds">2 Giường Đơn</option>
                    <option value="2 queen beds">2 Giường Queen</option>
                  </select>
                </label>

                <label>
                  Sức Chứa Tối Đa
                  <select value={guests} onChange={e => setGuests(e.target.value)}>
                    <option value="1">1 Người</option>
                    <option value="2">2 Người</option>
                    <option value="3">3 Người</option>
                    <option value="4">4 Người</option>
                    <option value="6">6 Người</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label>
                  Diện Tích (m²)
                  <input
                    type="number"
                    min="10"
                    value={size}
                    onChange={e => setSize(e.target.value)}
                    required
                  />
                </label>

                <label>
                  Giá Gốc ($/đêm)
                  <input
                    type="number"
                    min="0"
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                    required
                  />
                </label>
              </div>

              <label>
                Mô Tả Hạng Phòng
                <textarea
                  rows="3"
                  placeholder="Mô tả không gian, tầm nhìn, trang thiết bị..."
                  value={desc}
                  onChange={e => setDesc(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--line)', fontFamily: 'inherit' }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setShowAddModal(false)}>Hủy</button>
              <button type="submit" className="btn primary">Lưu Hạng Phòng</button>
            </div>
          </form>
        </div>
      )}

      {/* Manage Seasonal Pricing Modal (UC32) */}
      {editingSeasonal && (
        <div className="scrim" onClick={() => setEditingSeasonal(null)} style={{ display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '1.75rem', width: 'min(550px, 92vw)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Giá Theo Mùa: {editingSeasonal.name}</h2>
              <button onClick={() => setEditingSeasonal(null)} style={{ border: 0, background: '#eee', borderRadius: '99px', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>
            <p className="muted" style={{ margin: '0 0 1.25rem' }}>
              Giá cơ bản hiện tại: <strong>${editingSeasonal.price}/đêm</strong> (UC32 - Manage Room Prices)
            </p>

            {/* List existing seasons */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--muted)' }}>Các Đợt Điều Chỉnh Đang Áp Dụng:</h4>
              {editingSeasonal.seasonalPricing && editingSeasonal.seasonalPricing.length > 0 ? (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {editingSeasonal.seasonalPricing.map((s, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                      <div>
                        <strong>{s.seasonName}</strong>
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          {new Date(s.startDate).toLocaleDateString()} → {new Date(s.endDate).toLocaleDateString()}
                        </div>
                      </div>
                      <strong style={{ color: 'var(--green)', fontSize: '1.1rem' }}>${s.price}/đêm</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', textAlign: 'center', color: 'var(--muted)' }}>
                  Chưa có đợt giá mùa nào. Giá sẽ luôn là giá gốc ${editingSeasonal.price}/đêm.
                </div>
              )}
            </div>

            {/* Form add season */}
            <form onSubmit={handleAddSeason} style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
              <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>+ Thêm Khoảng Giá Mùa Mới</h4>
              <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
                <label>
                  Tên Dịp/Mùa (Ví dụ: Cao điểm Tết, Hè 2026)
                  <input
                    type="text"
                    placeholder="Mùa hè 2026"
                    value={seasonName}
                    onChange={e => setSeasonName(e.target.value)}
                    required
                  />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <label>
                    Từ Ngày
                    <input type="date" value={seasonStart} onChange={e => setSeasonStart(e.target.value)} required />
                  </label>
                  <label>
                    Đến Ngày
                    <input type="date" value={seasonEnd} onChange={e => setSeasonEnd(e.target.value)} required />
                  </label>
                </div>
                <label>
                  Giá Điều Chỉnh ($/đêm)
                  <input type="number" min="0" placeholder="120" value={seasonPrice} onChange={e => setSeasonPrice(e.target.value)} required />
                </label>
              </div>
              <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={seasonSaving}>
                {seasonSaving ? 'Đang lưu…' : 'Áp Dụng Đợt Giá Này'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
