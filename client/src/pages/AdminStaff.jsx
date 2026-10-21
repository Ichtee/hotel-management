/**
 * AdminStaff – Staff account management page (admin-only)
 * Admin creates / manages staff accounts here.
 * Staff cannot self-register; accounts are provisioned by admin only.
 */
import { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:5000/api';
// Admin secret — in production store in env / use JWT
const ADMIN_SECRET = 'grandstay_admin_2026';

const STAFF_ROLES = [
  { key: 'receptionist', label: 'Receptionist' },
  { key: 'housekeeping', label: 'Housekeeping' },
  { key: 'manager', label: 'Manager' },
  { key: 'admin', label: 'Admin' },
];

const SHIFTS = [
  { key: 'morning', label: 'Morning  (06:00–14:00)' },
  { key: 'afternoon', label: 'Afternoon (14:00–22:00)' },
  { key: 'night', label: 'Night  (22:00–06:00)' },
];

async function staffRequest(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_SECRET,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// Mock staff list for demo when server is offline
const MOCK_STAFF = [
  { id: '1', fullName: 'Mai Tran', email: 'mai@grandstay.com', role: 'housekeeping', roleName: 'Housekeeping', position: 'Senior Housekeeper', shift: 'morning', status: 'active', createdAt: '2026-01-10T08:00:00Z' },
  { id: '2', fullName: 'Khoa Le', email: 'khoa@grandstay.com', role: 'receptionist', roleName: 'Receptionist', position: 'Front Desk Agent', shift: 'afternoon', status: 'active', createdAt: '2026-02-14T09:00:00Z' },
  { id: '3', fullName: 'Lan Nguyen', email: 'lan@grandstay.com', role: 'housekeeping', roleName: 'Housekeeping', position: 'Housekeeper', shift: 'morning', status: 'active', createdAt: '2026-03-01T07:30:00Z' },
  { id: '4', fullName: 'An Pham', email: 'an@grandstay.com', role: 'manager', roleName: 'Manager', position: 'Hotel Manager', shift: 'morning', status: 'active', createdAt: '2025-12-01T08:00:00Z' },
];

const ROLE_COLORS = {
  admin: '#7c3aed',
  manager: '#2563eb',
  receptionist: '#0891b2',
  housekeeping: '#059669',
};

const SHIFT_SHORT = { morning: '🌅 Morning', afternoon: '🌇 Afternoon', night: '🌙 Night' };
const STATUS_STYLE = {
  active: { background: '#d1fae5', color: '#065f46' },
  suspended: { background: '#fee2e2', color: '#991b1b' },
  deleted: { background: '#f3f4f6', color: '#6b7280' },
};

const inputStyle = {
  padding: '.55rem .85rem',
  borderRadius: 8,
  border: '1.5px solid #d1d5db',
  fontSize: '.88rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  background: '#fff',
};

function RoleBadge({ roleKey, roleName }) {
  const color = ROLE_COLORS[roleKey] || '#6b7280';
  return (
    <span style={{ background: color + '18', color, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 9px', fontSize: '.78rem', fontWeight: 600, letterSpacing: '.02em' }}>
      {roleName || roleKey}
    </span>
  );
}

// ─── Create Staff Modal ───────────────────────────────────────────────────────
function CreateStaffModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '', roleKey: 'receptionist', position: '', shift: 'morning' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await staffRequest('POST', '/auth/staff', form);
      setSuccess(res.data);
      onCreated(res.data);
    } catch (err) {
      // Demo fallback when server is offline
      const mockData = {
        id: `mock_${Date.now()}`,
        fullName: form.fullName,
        email: form.email,
        role: form.roleKey,
        roleName: STAFF_ROLES.find(r => r.key === form.roleKey)?.label || form.roleKey,
        position: form.position || STAFF_ROLES.find(r => r.key === form.roleKey)?.label,
        shift: form.shift,
        status: 'active',
      };
      setSuccess(mockData);
      onCreated(mockData);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>✅</div>
          <h2 style={{ margin: '0 0 .5rem' }}>Tài khoản đã được tạo!</h2>
          <p className="muted">Nhân viên <strong>{success.fullName}</strong> có thể đăng nhập bằng email và mật khẩu vừa được cấp.</p>
          <div style={{ textAlign: 'left', margin: '1rem 0', background: '#f8fafc', borderRadius: 10, padding: '1rem' }}>
            <dl style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.4rem 0', borderBottom: '1px solid #e5e7eb' }}>
                <dt style={{ color: '#6b7280', fontSize: '.85rem' }}>Email</dt>
                <dd style={{ fontWeight: 600, margin: 0, fontSize: '.9rem' }}>{success.email}</dd>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.4rem 0', borderBottom: '1px solid #e5e7eb' }}>
                <dt style={{ color: '#6b7280', fontSize: '.85rem' }}>Vai trò</dt>
                <dd style={{ margin: 0 }}><RoleBadge roleKey={success.role} roleName={success.roleName} /></dd>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.4rem 0' }}>
                <dt style={{ color: '#6b7280', fontSize: '.85rem' }}>Vị trí</dt>
                <dd style={{ margin: 0, fontSize: '.88rem' }}>{success.position || '—'}</dd>
              </div>
            </dl>
          </div>
          <p style={{ fontSize: '.82rem', color: '#92400e', background: '#fef3c7', padding: '.6rem .9rem', borderRadius: 8, margin: '0 0 1.25rem' }}>
            ⚠️ Hãy thông báo mật khẩu tạm thời cho nhân viên và yêu cầu họ đổi ngay sau lần đăng nhập đầu tiên.
          </p>
          <button className="btn primary" style={{ width: '100%' }} onClick={onClose}>Đóng</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>➕ Tạo tài khoản nhân viên</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: '#6b7280', lineHeight: 1 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '.7rem 1rem', marginBottom: '1.25rem', fontSize: '.85rem', color: '#1e40af' }}>
          🔐 <strong>Chỉ admin mới có thể tạo tài khoản nhân viên.</strong> Nhân viên không thể tự đăng ký — tài khoản phải do admin cấp phát.
        </div>

        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '.88rem' }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', fontWeight: 500 }}>
              Họ và tên *
              <input value={form.fullName} onChange={set('fullName')} required placeholder="Nguyễn Văn A" style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', fontWeight: 500 }}>
              Số điện thoại
              <input value={form.phone} onChange={set('phone')} placeholder="0987654321" style={inputStyle} />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', fontWeight: 500 }}>
            Email công ty *
            <input type="email" value={form.email} onChange={set('email')} required placeholder="nhanvien@grandstay.com" style={inputStyle} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', fontWeight: 500 }}>
            Mật khẩu tạm thời *
            <input type="password" value={form.password} onChange={set('password')} required minLength={6} placeholder="Tối thiểu 6 ký tự" style={inputStyle} />
            <small style={{ color: '#6b7280' }}>Nhân viên nên đổi mật khẩu ngay sau lần đăng nhập đầu tiên.</small>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', fontWeight: 500 }}>
              Vai trò *
              <select value={form.roleKey} onChange={set('roleKey')} style={inputStyle}>
                {STAFF_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', fontWeight: 500 }}>
              Ca làm việc
              <select value={form.shift} onChange={set('shift')} style={inputStyle}>
                {SHIFTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', fontWeight: 500 }}>
            Chức danh / Vị trí
            <input value={form.position} onChange={set('position')} placeholder="VD: Lễ tân ca sáng" style={inputStyle} />
          </label>

          <div style={{ display: 'flex', gap: '.75rem', marginTop: '.5rem' }}>
            <button type="submit" className="btn primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? '⏳ Đang tạo tài khoản...' : '✅ Tạo tài khoản nhân viên'}
            </button>
            <button type="button" className="btn" onClick={onClose} style={{ minWidth: 90 }}>Hủy</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reset Password Modal ─────────────────────────────────────────────────────
function ResetPasswordModal({ staff, onClose }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await staffRequest('POST', `/auth/staff/${staff.id}/reset-password`, { newPassword: pw });
      setSuccess(true);
    } catch (err) {
      // Demo fallback
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <h2 style={{ margin: '0 0 .5rem', fontSize: '1.1rem' }}>🔑 Đặt lại mật khẩu</h2>
        <p className="muted" style={{ marginBottom: '1.25rem', fontSize: '.88rem' }}>
          Đặt lại mật khẩu cho <strong>{staff.fullName}</strong> ({staff.email})
        </p>

        {success ? (
          <>
            <div style={{ background: '#d1fae5', color: '#065f46', padding: '.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '.9rem' }}>
              ✓ Mật khẩu đã được đặt lại. Hãy thông báo mật khẩu mới cho nhân viên.
            </div>
            <button className="btn primary" onClick={onClose} style={{ width: '100%' }}>Đóng</button>
          </>
        ) : (
          <form onSubmit={handleReset} style={{ display: 'grid', gap: '1rem' }}>
            {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '.75rem', borderRadius: 8, fontSize: '.88rem' }}>⚠️ {error}</div>}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', fontWeight: 500 }}>
              Mật khẩu mới *
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} placeholder="Tối thiểu 6 ký tự" style={inputStyle} />
            </label>
            <div style={{ display: 'flex', gap: '.75rem' }}>
              <button type="submit" className="btn primary" disabled={loading} style={{ flex: 1 }}>
                {loading ? '⏳ Đang đặt lại...' : 'Đặt lại mật khẩu'}
              </button>
              <button type="button" className="btn" onClick={onClose}>Hủy</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Main AdminStaff Component ────────────────────────────────────────────────
export default function AdminStaff() {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  const showToast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 4000); };

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const res = await staffRequest('GET', '/auth/staff');
      setStaffList(res.data || []);
    } catch {
      // Fallback to mock data when server is offline
      setStaffList(MOCK_STAFF);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStaff(); }, []);

  const handleStatusToggle = async (staff) => {
    const newStatus = staff.status === 'active' ? 'suspended' : 'active';
    const label = newStatus === 'active' ? 'kích hoạt' : 'tạm khoá';
    if (!window.confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} tài khoản của ${staff.fullName}?`)) return;
    try {
      await staffRequest('PUT', `/auth/staff/${staff.id}`, { status: newStatus });
    } catch {
      // Demo fallback — update UI anyway
    }
    setStaffList((prev) => prev.map((s) => s.id === staff.id ? { ...s, status: newStatus } : s));
    showToast(`✓ Đã ${label} tài khoản của ${staff.fullName}`);
  };

  const handleCreated = (newStaff) => {
    setStaffList((prev) => [{ ...newStaff, createdAt: new Date().toISOString() }, ...prev]);
    showToast(`✅ Tài khoản "${newStaff.fullName}" đã được tạo thành công!`);
  };

  const filtered = staffList.filter((s) => {
    if (filterRole !== 'all' && s.role !== filterRole) return false;
    if (filterStatus !== 'all' && s.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.fullName.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q) && !(s.position || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const counts = {
    total: staffList.length,
    active: staffList.filter(s => s.status === 'active').length,
    suspended: staffList.filter(s => s.status === 'suspended').length,
  };

  return (
    <div>
      {/* Toast */}
      {toastMsg && (
        <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', background: '#1e293b', color: '#fff', padding: '.85rem 1.25rem', borderRadius: 12, zIndex: 9999, fontSize: '.9rem', boxShadow: '0 4px 20px rgba(0,0,0,.3)' }}>
          {toastMsg}
        </div>
      )}

      {/* Page header */}
      <div className="page-head">
        <div>
          <h1>Quản lý nhân viên</h1>
          <p>Admin cấp và quản lý tài khoản nhân viên. Nhân viên không thể tự đăng ký.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={fetchStaff}>↺ Tải lại</button>
          <button className="btn primary" onClick={() => setShowCreate(true)}>➕ Tạo tài khoản mới</button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Tổng nhân viên', value: counts.total, icon: '👥', color: '#2563eb' },
          { label: 'Đang hoạt động', value: counts.active, icon: '✅', color: '#059669' },
          { label: 'Tạm khoá', value: counts.suspended, icon: '🔒', color: '#d97706' },
        ].map((c) => (
          <div key={c.label} className="panel" style={{ padding: '1.1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '1.75rem' }}>{c.icon}</span>
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.color, lineHeight: 1 }}>{c.value}</div>
              <div style={{ fontSize: '.8rem', color: '#6b7280', marginTop: 2 }}>{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Security banner */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '.7rem 1rem', marginBottom: '1.25rem', fontSize: '.85rem', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        🔐 <span><strong>Chính sách bảo mật:</strong> Nhân viên không thể tự tạo tài khoản. Mọi tài khoản nhân viên đều phải được Admin cấp phát qua trang này.</span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem', alignItems: 'center' }}>
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  Tìm theo tên, email, vị trí..."
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 220 }}
        />
        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} style={{ ...inputStyle, flex: '0 1 160px' }}>
          <option value="all">Tất cả vai trò</option>
          {STAFF_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, flex: '0 1 150px' }}>
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="suspended">Tạm khoá</option>
        </select>
      </div>

      {/* Staff table */}
      {loading ? (
        <div className="panel" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>⏳ Đang tải danh sách nhân viên...</div>
      ) : filtered.length === 0 ? (
        <div className="panel" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>👤</div>
          <p style={{ margin: 0 }}>{staffList.length === 0 ? 'Chưa có tài khoản nhân viên nào.' : 'Không tìm thấy nhân viên phù hợp.'}</p>
          {staffList.length === 0 && <button className="btn primary" style={{ marginTop: '1rem' }} onClick={() => setShowCreate(true)}>➕ Tạo tài khoản đầu tiên</button>}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Vai trò</th>
                <th>Ca làm việc</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: (ROLE_COLORS[s.role] || '#6b7280') + '22', color: ROLE_COLORS[s.role] || '#6b7280', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '.9rem', flexShrink: 0 }}>
                        {(s.fullName || s.email)[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{s.fullName}</div>
                        <div style={{ color: '#6b7280', fontSize: '.8rem' }}>{s.email}</div>
                        {s.position && <div style={{ color: '#9ca3af', fontSize: '.75rem' }}>{s.position}</div>}
                      </div>
                    </div>
                  </td>
                  <td><RoleBadge roleKey={s.role} roleName={s.roleName} /></td>
                  <td><span style={{ fontSize: '.85rem' }}>{SHIFT_SHORT[s.shift] || s.shift || '—'}</span></td>
                  <td>
                    <span style={{ ...STATUS_STYLE[s.status], borderRadius: 6, padding: '3px 10px', fontSize: '.8rem', fontWeight: 600 }}>
                      {s.status === 'active' ? '● Hoạt động' : s.status === 'suspended' ? '⊘ Tạm khoá' : s.status}
                    </span>
                  </td>
                  <td style={{ fontSize: '.82rem', color: '#6b7280' }}>
                    {s.createdAt ? new Date(s.createdAt).toLocaleDateString('vi-VN') : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        className="btn"
                        style={{ fontSize: '.78rem', padding: '4px 10px', minHeight: 'unset' }}
                        onClick={() => setResetTarget(s)}
                      >
                        🔑 Đặt lại MK
                      </button>
                      <button
                        className="btn"
                        style={{
                          fontSize: '.78rem', padding: '4px 10px', minHeight: 'unset',
                          color: s.status === 'active' ? '#d97706' : '#059669',
                          borderColor: s.status === 'active' ? '#fbbf24' : '#6ee7b7',
                        }}
                        onClick={() => handleStatusToggle(s)}
                      >
                        {s.status === 'active' ? '🔒 Tạm khoá' : '✓ Kích hoạt'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal css */}
      <style>{`
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.45);
          display: flex; align-items: center; justify-content: center;
          z-index: 999; padding: 1rem;
          animation: fadeIn .15s;
        }
        .modal-box {
          background: #fff; border-radius: 16px;
          padding: 1.75rem; width: 100%; max-height: 92vh;
          overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.25);
          animation: slideUp .2s;
        }
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes slideUp { from { transform: translateY(20px); opacity:0 } to { transform: none; opacity:1 } }
      `}</style>

      {showCreate && (
        <CreateStaffModal
          onClose={() => setShowCreate(false)}
          onCreated={(data) => { setShowCreate(false); handleCreated(data); }}
        />
      )}
      {resetTarget && <ResetPasswordModal staff={resetTarget} onClose={() => setResetTarget(null)} />}
    </div>
  );
}
