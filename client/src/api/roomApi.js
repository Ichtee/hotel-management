import { api, apiAll } from './client.js';
const query = (params) => new URLSearchParams(params).toString();

// Dùng chung xác thực, xử lý lỗi và thông báo hết phiên với các màn khác.
export const roomApi = {
  getRoomTypes: (params = {}) => api('/public/room-types?' + query(params)),
  getRooms: (params = {}) => apiAll('/rooms?' + query(params)),
  createRoom: (body) => api('/rooms', { method: 'POST', body }),
  updateRoomStatus: (id, status) => api('/rooms/' + id + '/maintenance', { method: 'PATCH', body: { enabled: status === 'maintenance' } }),
  deleteRoom: (id) => api('/rooms/' + id, { method: 'PATCH', body: { isActive: false } }),
};
