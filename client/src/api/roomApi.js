// Gọi API quản lý phòng và tình trạng trống.

const API_BASE = '/api';

async function request(endpoint, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || errData.message || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    // Ghi lỗi kết nối rồi chuyển lỗi cho nơi gọi xử lý.
    console.warn(`[roomApi] Failed ${options.method || 'GET'} ${endpoint}:`, error.message);
    throw error;
  }
}

export const roomApi = {
  // Lấy danh sách loại phòng.
  async getRoomTypes(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request(`/public/room-types${q ? '?' + q : ''}`).catch(() => request(`/room-types${q ? '?' + q : ''}`));
  },

  // Lấy danh sách phòng theo bộ lọc.
  async getRooms(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request(`/rooms${q ? '?' + q : ''}`);
  },

  async createRoom(data) {
    return request('/rooms', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Chỉ đổi bảo trì thủ công; trạng thái khác theo nhận, trả và dọn phòng.
  async updateRoomStatus(id, status) {
    return request(`/rooms/${id}/maintenance`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: status === 'maintenance' })
    });
  },

  // Vô hiệu hóa phòng để giữ nguyên lịch sử booking.
  async deleteRoom(id) {
    return request(`/rooms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false })
    });
  }
};
