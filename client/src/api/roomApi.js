/** Room and inventory API client. */

const API_BASE = '/api';

async function request(endpoint, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    // If backend is not running or network fails, log info and throw for caller fallback
    console.warn(`[roomApi] Failed ${options.method || 'GET'} ${endpoint}:`, error.message);
    throw error;
  }
}

export const roomApi = {
  // --- Room Types (UC31, UC06, UC32) ---
  async getRoomTypes(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request(`/public/room-types${q ? '?' + q : ''}`);
  },

  async getRoomTypeById(id) {
    return request(`/public/room-types/${id}`);
  },

  async createRoomType(data) {
    return request('/room-types', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateRoomType(id, data) {
    return request(`/room-types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async deleteRoomType(id) {
    return request(`/room-types/${id}`, {
      method: 'DELETE'
    });
  },

  async updatePricing(id, pricingData) {
    return request(`/room-types/${id}/pricing`, {
      method: 'PUT',
      body: JSON.stringify(pricingData)
    });
  },

  // --- Rooms & Room Map (UC30, UC05) ---
  async getRooms(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request(`/rooms${q ? '?' + q : ''}`);
  },

  async searchRooms(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request(`/rooms/search${q ? '?' + q : ''}`);
  },

  async createRoom(data) {
    return request('/rooms', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // UC23: the manager only switches Maintenance on or off; other statuses follow check-in, check-out and cleaning (BR-04, BR-05).
  async updateRoomStatus(id, status) {
    return request(`/rooms/${id}/maintenance`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: status === 'maintenance' })
    });
  },

  // UC23 3c: rooms are deactivated, never deleted, so past bookings keep their room.
  async deleteRoom(id) {
    return request(`/rooms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false })
    });
  }
};
