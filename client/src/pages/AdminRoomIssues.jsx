import { useState, useEffect } from 'react';
import { roomApi } from '../api/roomApi.js';

const SEVERITY_CONFIG = {
  low: { label: 'Thấp (Low)', color: '#2e9e63', badge: 'b-low' },
  medium: { label: 'Trung bình (Medium)', color: '#e0a030', badge: 'b-medium' },
  high: { label: 'Nghiêm trọng (High)', color: '#d32f2f', badge: 'b-high' }
};

const STATUS_CONFIG = {
  open: { label: 'Đang xử lý (Open)', badge: 'b-pending' },
  resolved: { label: 'Đã khắc phục (Resolved)', badge: 'b-confirmed' }
};

export default function AdminRoomIssues() {
  const [issues, setIssues] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [showReportModal, setShowReportModal] = useState(false);
  const [resolvingIssue, setResolvingIssue] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

  // Report form states
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [submitting, setSubmitting] = useState(false);

  // Resolve form states
  const [returnStatus, setReturnStatus] = useState('cleaning');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [issueRes, roomRes] = await Promise.allSettled([
        roomApi.getRoomIssues(),
        roomApi.getRooms()
      ]);

      if (issueRes.status === 'fulfilled') {
        const rawIssues = Array.isArray(issueRes.value) ? issueRes.value : (issueRes.value?.data || []);
        setIssues(rawIssues);
      }

      if (roomRes.status === 'fulfilled') {
        const rawRooms = Array.isArray(roomRes.value) ? roomRes.value : (roomRes.value?.data || []);
        setRooms(rawRooms);
        if (rawRooms.length > 0 && !selectedRoomId) {
          setSelectedRoomId(rawRooms[0]._id || rawRooms[0].id);
        }
      }
    } catch (err) {
      console.warn('Error loading room issues:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateIssue = async (e) => {
    e.preventDefault();
    if (!selectedRoomId || !title.trim()) {
      alert('Vui lòng điền đủ thông tin phòng và tiêu đề sự cố');
      return;
    }

    setSubmitting(true);
    try {
      await roomApi.createRoomIssue({
        roomId: selectedRoomId,
        title: title.trim(),
        description: description.trim(),
        severity
      });
      const roomObj = rooms.find(r => (r._id || r.id) === selectedRoomId);
      const roomNum = roomObj?.roomNumber || roomObj?.no || 'đã chọn';
      showToast(`Đã báo cáo sự cố phòng ${roomNum}${severity === 'high' ? ' (Phòng chuyển sang Maintenance)' : ''}!`);
      setShowReportModal(false);
      setTitle('');
      setDescription('');
      setSeverity('medium');
      loadData();
    } catch (err) {
      alert(`Lỗi khi báo cáo sự cố: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolveIssue = async (e) => {
    e.preventDefault();
    if (!resolvingIssue) return;

    try {
      await roomApi.resolveRoomIssue(resolvingIssue._id || resolvingIssue.id, {
        returnRoomStatus: returnStatus
      });
      showToast(`Sự cố đã được giải quyết! Trạng thái phòng được cập nhật thành "${returnStatus}".`);
      setResolvingIssue(null);
      loadData();
    } catch (err) {
      alert(`Lỗi khi khắc phục sự cố: ${err.message}`);
    }
  };

  const counts = {
    total: issues.length,
    open: issues.filter(i => i.status === 'open').length,
    resolved: issues.filter(i => i.status === 'resolved').length,
    high: issues.filter(i => i.severity === 'high' && i.status === 'open').length
  };

  const filteredIssues = issues.filter(i => {
    if (filterStatus !== 'all' && i.status !== filterStatus) return false;
    if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false;
    return true;
  });

  return (
    <div className="admin-issues-page">
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
          <h1>Báo Cáo Sự Cố Phòng & Bảo Trì (Room Issues)</h1>
          <p>Ghi nhận hư hỏng, cách ly phòng bảo trì và khôi phục hoạt động (UC40)</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setShowReportModal(true)}>+ Báo Cáo Sự Cố Mới</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '0.75rem', marginBottom: '1.25rem'
      }}>
        <div style={{ background: '#fff', padding: '14px 18px', borderRadius: '12px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Tổng sự cố</span>
          <strong style={{ display: 'block', fontSize: '1.6rem', color: 'var(--navy)' }}>{counts.total}</strong>
        </div>
        <div
          onClick={() => setFilterStatus(filterStatus === 'open' ? 'all' : 'open')}
          style={{
            background: filterStatus === 'open' ? '#e0a030' : '#fff',
            color: filterStatus === 'open' ? '#fff' : 'var(--text)',
            padding: '14px 18px', borderRadius: '12px',
            border: '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.15s'
          }}
        >
          <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>Đang xử lý</span>
          <strong style={{ display: 'block', fontSize: '1.6rem' }}>{counts.open}</strong>
        </div>
        <div
          onClick={() => { setFilterSeverity(filterSeverity === 'high' ? 'all' : 'high'); setFilterStatus('open'); }}
          style={{
            background: filterSeverity === 'high' ? '#d32f2f' : '#fff',
            color: filterSeverity === 'high' ? '#fff' : 'var(--text)',
            padding: '14px 18px', borderRadius: '12px',
            border: '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.15s'
          }}
        >
          <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>Mức độ cao (High)</span>
          <strong style={{ display: 'block', fontSize: '1.6rem', color: filterSeverity === 'high' ? '#fff' : 'var(--red)' }}>{counts.high}</strong>
        </div>
        <div
          onClick={() => setFilterStatus(filterStatus === 'resolved' ? 'all' : 'resolved')}
          style={{
            background: filterStatus === 'resolved' ? '#2e9e63' : '#fff',
            color: filterStatus === 'resolved' ? '#fff' : 'var(--text)',
            padding: '14px 18px', borderRadius: '12px',
            border: '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.15s'
          }}
        >
          <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>Đã giải quyết</span>
          <strong style={{ display: 'block', fontSize: '1.6rem' }}>{counts.resolved}</strong>
        </div>
      </div>

      {/* Filter Chips */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <div className="chips" style={{ margin: 0 }}>
          <button className={`chip ${filterStatus === 'all' ? 'on' : ''}`} onClick={() => setFilterStatus('all')}>
            Tất cả trạng thái
          </button>
          <button className={`chip ${filterStatus === 'open' ? 'on' : ''}`} onClick={() => setFilterStatus('open')}>
            Đang mở ({counts.open})
          </button>
          <button className={`chip ${filterStatus === 'resolved' ? 'on' : ''}`} onClick={() => setFilterStatus('resolved')}>
            Đã xong ({counts.resolved})
          </button>
        </div>

        <div className="chips" style={{ margin: 0 }}>
          <button className={`chip ${filterSeverity === 'all' ? 'on' : ''}`} onClick={() => setFilterSeverity('all')}>
            Tất cả mức độ
          </button>
          {Object.entries(SEVERITY_CONFIG).map(([sev, cfg]) => (
            <button key={sev} className={`chip ${filterSeverity === sev ? 'on' : ''}`} onClick={() => setFilterSeverity(sev)}>
              {cfg.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap" style={{ background: '#fff', borderRadius: '14px', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Phòng</th>
              <th>Tiêu đề sự cố</th>
              <th>Chi tiết mô tả</th>
              <th>Mức độ nghiêm trọng</th>
              <th>Ngày báo cáo</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Đang tải danh sách sự cố…</td></tr>
            ) : filteredIssues.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Không có sự cố nào phù hợp.</td></tr>
            ) : filteredIssues.map(issue => {
              const rNumber = issue.roomId?.roomNumber || issue.roomNumber || 'N/A';
              const issueId = issue._id || issue.id;
              const dateStr = issue.createdAt ? new Date(issue.createdAt).toLocaleDateString() : 'Hôm nay';
              const sevCfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.medium;

              return (
                <tr key={issueId}>
                  <td><strong>Phòng {rNumber}</strong></td>
                  <td><strong>{issue.title}</strong></td>
                  <td style={{ maxWidth: '280px', fontSize: '0.85rem' }}>{issue.description || 'Không có mô tả thêm'}</td>
                  <td>
                    <span className={`badge ${sevCfg.badge}`} style={{ color: sevCfg.color, borderColor: sevCfg.color }}>
                      ● {sevCfg.label}
                    </span>
                  </td>
                  <td>{dateStr}</td>
                  <td>
                    <span className={`badge ${STATUS_CONFIG[issue.status]?.badge || 'b-pending'}`}>
                      {STATUS_CONFIG[issue.status]?.label || issue.status}
                    </span>
                  </td>
                  <td>
                    {issue.status === 'open' ? (
                      <button
                        className="btn"
                        style={{ padding: '5px 12px', fontSize: '0.8rem', background: '#2e9e63', color: '#fff', borderColor: '#2e9e63' }}
                        onClick={() => setResolvingIssue(issue)}
                      >
                        Khắc phục xong
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--green)', fontWeight: 600 }}>✓ Đã xử lý</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Báo Cáo Sự Cố Mới */}
      {showReportModal && (
        <div className="scrim" onClick={() => setShowReportModal(false)} style={{ display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <form
            onSubmit={handleCreateIssue}
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '1.75rem', width: 'min(500px, 92vw)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto'
            }}
          >
            <h2 style={{ margin: '0 0 0.25rem' }}>Báo Cáo Sự Cố Phòng Mới</h2>
            <p className="muted" style={{ margin: '0 0 1.25rem' }}>Ghi nhận sự cố kỹ thuật hoặc thiết bị hỏng hóc (UC40)</p>

            <div style={{ display: 'grid', gap: '0.9rem', marginBottom: '1.5rem' }}>
              <label>
                Chọn Phòng Gặp Sự Cố
                <select
                  value={selectedRoomId}
                  onChange={e => setSelectedRoomId(e.target.value)}
                  required
                >
                  {rooms.length === 0 ? (
                    <option value="">Không có phòng</option>
                  ) : (
                    rooms.map(r => (
                      <option key={r._id || r.id} value={r._id || r.id}>
                        Phòng {r.roomNumber || r.no} (Tầng {r.floor || r.no?.[0] || 1}) - {r.status}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label>
                Tiêu Đề Sự Cố
                <input
                  type="text"
                  placeholder="Ví dụ: Rò rỉ nước điều hòa, vỡ bóng đèn, hỏng khóa từ"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  required
                />
              </label>

              <label>
                Mức Độ Nghiêm Trọng
                <select value={severity} onChange={e => setSeverity(e.target.value)}>
                  <option value="low">Thấp (Low) - Hư hỏng nhỏ, khách vẫn ở được</option>
                  <option value="medium">Trung bình (Medium) - Cần khắc phục trong ngày</option>
                  <option value="high">Nghiêm trọng (High) - Chuyển phòng sang Bảo Trì (Maintenance)</option>
                </select>
              </label>

              <label>
                Mô Tả Chi Tiết
                <textarea
                  rows="3"
                  placeholder="Vị trí hư hỏng, biểu hiện, cần thiết bị thay thế nào..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--line)', fontFamily: 'inherit' }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setShowReportModal(false)}>Hủy</button>
              <button type="submit" className="btn primary" disabled={submitting}>
                {submitting ? 'Đang gửi…' : 'Gửi Báo Cáo Sự Cố'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Khắc Phục Xong Sự Cố */}
      {resolvingIssue && (
        <div className="scrim" onClick={() => setResolvingIssue(null)} style={{ display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <form
            onSubmit={handleResolveIssue}
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '1.75rem', width: 'min(440px, 92vw)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)'
            }}
          >
            <h2 style={{ margin: '0 0 0.25rem' }}>Xác Nhận Đã Khắc Phục</h2>
            <p className="muted" style={{ margin: '0 0 1.25rem' }}>
              Sự cố: <strong>{resolvingIssue.title}</strong> (Phòng {resolvingIssue.roomId?.roomNumber || resolvingIssue.roomNumber || ''})
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label>
                Trạng Thái Phòng Sau Khắc Phục
                <select value={returnStatus} onChange={e => setReturnStatus(e.target.value)}>
                  <option value="cleaning">Chuyển sang "Cleaning" (Cần vệ sinh trước khi nhận khách)</option>
                  <option value="available">Chuyển sang "Available" (Sẵn sàng nhận khách ngay)</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setResolvingIssue(null)}>Đóng</button>
              <button type="submit" className="btn primary">Hoàn Tất & Khôi Phục Phòng</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

