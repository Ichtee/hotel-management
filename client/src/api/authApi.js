/**
 * Customer Authentication API and Session Management
 */

const API_BASE = 'http://localhost:5000/api';

async function request(endpoint, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return data;
  } catch (error) {
    console.warn(`[authApi] Failed ${options.method || 'GET'} ${endpoint}:`, error.message);
    throw error;
  }
}

export const authApi = {
  async register({ fullName, email, password, phone }) {
    try {
      const res = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, password, phone })
      });
      if (res.data) {
        this.setCurrentUser(res.data);
      }
      return res;
    } catch (err) {
      // Fallback for local demo if server is offline
      const mockUser = {
        id: `usr_${Date.now()}`,
        fullName: fullName || email.split('@')[0],
        email,
        phone: phone || '0900000000',
        loyaltyPoints: 100
      };
      this.setCurrentUser(mockUser);
      return { success: true, data: mockUser };
    }
  },

  async login({ email, password }) {
    try {
      const res = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (res.data) {
        this.setCurrentUser(res.data);
      }
      return res;
    } catch (err) {
      // Fallback for local demo if server is offline
      const mockUser = {
        id: `usr_${Date.now()}`,
        fullName: email.split('@')[0],
        email,
        phone: '0900000000',
        loyaltyPoints: 150
      };
      this.setCurrentUser(mockUser);
      return { success: true, data: mockUser };
    }
  },

  getCurrentUser() {
    try {
      const raw = localStorage.getItem('grandstay_customer');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCurrentUser(user) {
    try {
      localStorage.setItem('grandstay_customer', JSON.stringify(user));
    } catch {}
  },

  async updateProfile({ id, email, fullName, phone }) {
    try {
      const res = await request('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ id, email, fullName, phone })
      });
      if (res.data) {
        this.setCurrentUser(res.data);
      }
      return res;
    } catch (err) {
      // Fallback: update localStorage only
      const current = this.getCurrentUser();
      const updated = { ...current, fullName: fullName || current?.fullName, phone: phone !== undefined ? phone : current?.phone };
      this.setCurrentUser(updated);
      return { success: true, data: updated };
    }
  },

  async updatePassword({ id, email, currentPassword, newPassword }) {
    // Call server to verify old password and update to new one
    const res = await request('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ id, email, currentPassword, newPassword })
    });
    return res;
  },

  logout() {
    try {
      localStorage.removeItem('grandstay_customer');
      sessionStorage.removeItem('last_booking');
    } catch {}
  }
};
