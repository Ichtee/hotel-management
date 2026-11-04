import { useState, useEffect } from 'react';
import { roomApi } from '../api/roomApi.js';

const STATUS_CONFIG = {
  pending: { label: 'Chờ dọn', color: '#e0a030', badge: 'b-pending' },
  in_progress: { label: 'Đang dọn', color: '#1976d2', badge: 'b-in_progress' },
  done: { label: 'Hoàn thành', color: '#2e9e63', badge: 'b-confirmed' }
};

export default function AdminCleaningTasks() {
  const [tasks, setTasks] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Form states
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [taskNotes, setTaskNotes] = useState('Checkout clean');
  const [scheduledDate, setScheduledDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [taskRes, roomRes] = await Promise.allSettled([
        roomApi.getCleaningTasks(),
        roomApi.getRooms()
      ]);

      if (taskRes.status === 'fulfilled') {
        const rawTasks = Array.isArray(taskRes.value) ? taskRes.value : (taskRes.value?.data || []);
        setTasks(rawTasks);
      }

      if (roomRes.status === 'fulfilled') {
        const rawRooms = Array.isArray(roomRes.value) ? roomRes.value : (roomRes.value?.data || []);
        setRooms(rawRooms);
        if (rawRooms.length > 0 && !selectedRoomId) {
          setSelectedRoomId(rawRooms[0]._id || rawRooms[0].id);
        }
      }
    } catch (err) {
      console.warn('Error loading housekeeping tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateStatus = async (taskId, newStatus) => {
    try {
      await roomApi.updateCleaningTaskStatus(taskId, newStatus);
      showToast(`Đã chuyển trạng thái sang "${STATUS_CONFIG[newStatus]?.label || newStatus}"`);
      // Update local state and reload
      setTasks(prev => prev.map(t => (t._id === taskId || t.id === taskId) ? { ...t, status: newStatus } : t));
      loadData();
    } catch (err) {
      alert(`Lỗi khi cập nhật trạng thái: ${err.message}`);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!selectedRoomId) {
      alert('Vui lòng chọn phòng cần dọn');
      return;
    }

    setSubmitting(true);
    try {
      await roomApi.createCleaningTask({
        roomId: selectedRoomId,
        notes: taskNotes,
        scheduledDate: new Date(scheduledDate)
      });
      showToast('Phân công dọn phòng thành công! Phòng đã chuyển sang trạng thái "Cleaning".');
      setShowAssignModal(false);
      loadData();
    } catch (err) {
      alert(`Lỗi khi tạo công việc dọn phòng: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const counts = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    done: tasks.filter(t => t.status === 'done').length
  };

  const filteredTasks = filterStatus === 'all' ? tasks : tasks.filter(t => t.status === filterStatus);

  return (
    <div className="admin-cleaning-page">
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
          <h1>Quản lý Dọn Phòng (Housekeeping Tasks)</h1>
          <p>Phân công dọn dẹp, theo dõi tiến độ và kích hoạt phòng sẵn sàng đón khách (UC39)</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setShowAssignModal(true)}>+ Phân Công Dọn Phòng</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '0.75rem', marginBottom: '1.25rem'
      }}>
        <div style={{ background: '#fff', padding: '14px 18px', borderRadius: '12px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Tổng công việc</span>
          <strong style={{ display: 'block', fontSize: '1.6rem', color: 'var(--navy)' }}>{counts.total}</strong>
        </div>
        {Object.entries(STATUS_CONFIG).map(([k, cfg]) => (
          <div
            key={k}
            onClick={() => setFilterStatus(filterStatus === k ? 'all' : k)}
            style={{
              background: filterStatus === k ? cfg.color : '#fff',
              color: filterStatus === k ? '#fff' : 'var(--text)',
              padding: '14px 18px', borderRadius: '12px',
              border: `1px solid ${filterStatus === k ? cfg.color : 'var(--line)'}`,
              cursor: 'pointer', transition: 'all 0.15s'
            }}
          >
            <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>{cfg.label}</span>
            <strong style={{ display: 'block', fontSize: '1.6rem' }}>{counts[k]}</strong>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="chips" style={{ marginBottom: '1rem' }}>
        <button className={`chip ${filterStatus === 'all' ? 'on' : ''}`} onClick={() => setFilterStatus('all')}>
          Tất cả ({counts.total})
        </button>
        {Object.entries(STATUS_CONFIG).map(([k, cfg]) => (
          <button key={k} className={`chip ${filterStatus === k ? 'on' : ''}`} onClick={() => setFilterStatus(k)}>
            {cfg.label} ({counts[k]})
          </button>
        ))}
      </div>

      {/* Task List Table */}
      <div className="table-wrap" style={{ background: '#fff', borderRadius: '14px', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Phòng</th>
              <th>Tầng</th>
              <th>Nội dung dọn dẹp</th>
              <th>Ngày dự kiến</th>
              <th>Nhân viên</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Đang tải công việc dọn phòng…</td></tr>
            ) : filteredTasks.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Không có công việc nào trong danh mục này.</td></tr>
            ) : filteredTasks.map(t => {
              const rNumber = t.roomId?.roomNumber || t.roomNumber || 'N/A';
              const rFloor = t.roomId?.floor || t.floor || (rNumber !== 'N/A' ? rNumber[0] : '1');
              const assignedName = t.assignedTo?.username || t.assignedTo?.email || 'Chưa chỉ định';
              const taskId = t._id || t.id;
              const dateStr = t.scheduledDate ? new Date(t.scheduledDate).toLocaleDateString() : 'Hôm nay';

              return (
                <tr key={taskId}>
                  <td><strong>Phòng {rNumber}</strong></td>
                  <td>Tầng {rFloor}</td>
                  <td>{t.notes || 'Dọn định kỳ'}</td>
                  <td>{dateStr}</td>
                  <td>{assignedName}</td>
                  <td>
                    <span className={`badge ${STATUS_CONFIG[t.status]?.badge || 'b-pending'}`}>
                      {STATUS_CONFIG[t.status]?.label || t.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {t.status === 'pending' && (
                        <button
                          className="btn"
                          style={{ padding: '5px 10px', fontSize: '0.78rem', background: '#1976d2', color: '#fff', borderColor: '#1976d2' }}
                          onClick={() => handleUpdateStatus(taskId, 'in_progress')}
                        >
                          Bắt đầu dọn
                        </button>
                      )}
                      {t.status === 'in_progress' && (
                        <button
                          className="btn"
                          style={{ padding: '5px 10px', fontSize: '0.78rem', background: '#2e9e63', color: '#fff', borderColor: '#2e9e63' }}
                          onClick={() => handleUpdateStatus(taskId, 'done')}
                        >
                          Xong & Sẵn sàng (Available)
                        </button>
                      )}
                      {t.status === 'done' && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--green)', fontWeight: 600 }}>✓ Hoàn tất</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Phân Công Dọn Phòng */}
      {showAssignModal && (
        <div className="scrim" onClick={() => setShowAssignModal(false)} style={{ display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <form
            onSubmit={handleCreateTask}
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '1.75rem', width: 'min(480px, 92vw)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto'
            }}
          >
            <h2 style={{ margin: '0 0 0.25rem' }}>Phân Công Dọn Phòng Mới</h2>
            <p className="muted" style={{ margin: '0 0 1.25rem' }}>Tạo công việc vệ sinh và tự động cập nhật trạng thái phòng sang Cleaning (UC39)</p>

            <div style={{ display: 'grid', gap: '0.9rem', marginBottom: '1.5rem' }}>
              <label>
                Chọn Phòng Cần Vệ Sinh
                <select
                  value={selectedRoomId}
                  onChange={e => setSelectedRoomId(e.target.value)}
                  required
                >
                  {rooms.length === 0 ? (
                    <option value="">Không có phòng sẵn có</option>
                  ) : (
                    rooms.map(r => (
                      <option key={r._id || r.id} value={r._id || r.id}>
                        Phòng {r.roomNumber || r.no} (Tầng {r.floor || r.no?.[0] || 1}) - Hiện tại: {r.status}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label>
                Loại Vệ Sinh / Ghi Chú
                <select value={taskNotes} onChange={e => setTaskNotes(e.target.value)}>
                  <option value="Checkout clean">Dọn sau trả phòng (Checkout clean)</option>
                  <option value="Daily clean">Dọn dẹp hằng ngày (Daily clean)</option>
                  <option value="Deep clean">Tổng vệ sinh định kỳ (Deep clean)</option>
                  <option value="Bed sheet change">Thay ga trải giường & đồ dùng</option>
                </select>
              </label>

              <label>
                Ngày Thực Hiện
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  required
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setShowAssignModal(false)}>Hủy</button>
              <button type="submit" className="btn primary" disabled={submitting}>
                {submitting ? 'Đang lưu…' : 'Xác Nhận Phân Công'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

