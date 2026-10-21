/**
 * Customer Booking & Reservation API Client (UC07, T10)
 * Connects to http://localhost:5000/api with fallback to local mock data
 */

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
    console.warn(`[bookingApi] Failed ${options.method || 'GET'} ${endpoint}:`, error.message);
    throw error;
  }
}

export const bookingApi = {
  /**
   * UC07: Create an online reservation
   */
  async createBooking(bookingData) {
    return request('/bookings', {
      method: 'POST',
      body: JSON.stringify(bookingData)
    });
  },

  /**
   * T10: Get Customer Bookings (Dashboard / My Trips)
   */
  async getMyBookings(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request(`/bookings${q ? '?' + q : ''}`);
  },

  /**
   * Get Booking details by BK-XXXX reference
   */
  async getBookingByReference(reference) {
    return request(`/bookings/ref/${reference}`);
  },

  /**
   * Cancel an existing reservation
   */
  async cancelBooking(bookingId, reason = 'Cancelled by customer') {
    return request(`/bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  }
};
