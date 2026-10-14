/**
 * Room and Inventory API Client for Member 2
 * Connects to http://localhost:5000/api with seamless fallback to client mock data
 */

const API_BASE = 'http://localhost:5000/api';

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
    return request(`/room-types${q ? '?' + q : ''}`);
  },

  async getRoomTypeById(id) {
    return request(`/room-types/${id}`);
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

  async updateRoomStatus(id, status) {
    return request(`/rooms/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  },

  async deleteRoom(id) {
    return request(`/rooms/${id}`, {
      method: 'DELETE'
    });
  },

  // --- Housekeeping & Cleaning Tasks (UC39) ---
  async getCleaningTasks(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request(`/housekeeping/tasks${q ? '?' + q : ''}`);
  },

  async createCleaningTask(data) {
    return request('/housekeeping/tasks', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateCleaningTaskStatus(id, status) {
    return request(`/housekeeping/tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  },

  // --- Room Issues & Maintenance (UC40) ---
  async getRoomIssues(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request(`/housekeeping/issues${q ? '?' + q : ''}`);
  },

  async createRoomIssue(data) {
    return request('/housekeeping/issues', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async resolveRoomIssue(id, payload = {}) {
    return request(`/housekeeping/issues/${id}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }
};
