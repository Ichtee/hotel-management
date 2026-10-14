// Mock data shaped after server/src/models. Replace with API calls later.
export const MENU = [
  { label: 'Dashboard', href: '#/admin' },
  { label: 'Front desk', items: [['#/admin/bookings', 'Bookings', 'All reservations'], ['#/admin/frontdesk', 'Check-in / Check-out', 'Today’s arrivals & departures']] },
  { label: 'Rooms', items: [['#/admin/rooms', 'Room map', 'Live room status'], ['#/admin/roomtypes', 'Room types', 'Pricing & amenities'], ['#/admin/services', 'Services', 'Extras & add-ons']] },
  { label: 'Housekeeping', items: [['#/admin/cleaning', 'Cleaning tasks', 'Assigned to staff'], ['#/admin/issues', 'Room issues', 'Maintenance reports']] },
  { label: 'Billing', items: [['#/admin/invoices', 'Invoices', ''], ['#/admin/payments', 'Payments', ''], ['#/admin/refunds', 'Refunds', ''], ['#/admin/revenue', 'Revenue', '', ['revenue.read']], ['#/admin/coupons', 'Coupons', '', ['promotions.manage']]] },
  { label: 'Guests & staff', items: [['#/admin/users', 'Users', '', ['users.manage']], ['#/admin/staff', 'Staff', '', ['staff.manage']], ['#/admin/roles', 'Roles', '', ['roles.manage']], ['#/admin/reviews', 'Reviews', '']] },
  { label: 'Settings', items: [['#/admin/hotel', 'Hotel & policies', '']] }
];

export const STATS = [
  ['Occupancy', '78%', '+4% vs last week'], ['Arrivals today', '12', '5 checked in'],
  ['Departures today', '9', '3 checked out'], ['Revenue (today)', '$4,860', '+12%']
];

const b = (code, guest, room, type, inD, outD, total, status) => ({ code, guest, room, type, inD, outD, total, status });
export const BOOKINGS = [
  b('BK-1042', 'Nguyen An', '301', 'Deluxe Double', '12 Oct', '15 Oct', '$255', 'confirmed'),
  b('BK-1043', 'Tran Binh', '512', 'Family Suite', '12 Oct', '14 Oct', '$300', 'checked_in'),
  b('BK-1044', 'Le Chi', '204', 'Superior Twin', '12 Oct', '13 Oct', '$70', 'pending'),
  b('BK-1038', 'Pham Dung', '702', 'Presidential Suite', '10 Oct', '12 Oct', '$640', 'checked_in'),
  b('BK-1031', 'Hoang Em', '305', 'Deluxe Double', '08 Oct', '12 Oct', '$340', 'checked_out'),
  b('BK-1029', 'Vo Phuc', '210', 'Superior Twin', '09 Oct', '11 Oct', '$140', 'cancelled')
];

export const ROOMS = Array.from({ length: 24 }, (_, i) => {
  const floor = 2 + Math.floor(i / 6);
  const status = ['available', 'occupied', 'occupied', 'dirty', 'available', 'maintenance'][(i * 5 + 1) % 6];
  return { no: `${floor}${String((i % 6) + 1).padStart(2, '0')}`, status };
});

export const TABLES = {
  roomtypes: {
    title: 'Room types', sub: 'Base price, capacity and amenities', action: 'Add room type',
    cols: ['Name', 'Bed', 'Size', 'Max guests', 'Base price', 'Active'],
    rows: [['Deluxe Double', 'King', '32 m²', 2, '$85', 'active'], ['Superior Twin', '2 single', '28 m²', 2, '$70', 'active'], ['Family Suite', '2 queen', '55 m²', 4, '$150', 'active'], ['Presidential Suite', 'King', '90 m²', 3, '$320', 'inactive']]
  },
  services: {
    title: 'Services', sub: 'Extras that can be added to a stay', action: 'Add service',
    cols: ['Service', 'Category', 'Price', 'Status'],
    rows: [['Airport pickup', 'Transport', '$25', 'active'], ['Breakfast buffet', 'Food', '$12', 'active'], ['Laundry', 'Housekeeping', '$8', 'active'], ['Spa massage', 'Wellness', '$40', 'inactive']]
  },
  cleaning: {
    title: 'Cleaning tasks', sub: 'Housekeeping assignments', action: 'Assign task',
    cols: ['Room', 'Type', 'Assigned to', 'Due', 'Status'],
    rows: [['305', 'Checkout clean', 'Mai', '12:00', 'in_progress'], ['204', 'Daily clean', 'Lan', '13:30', 'pending'], ['512', 'Deep clean', 'Mai', '15:00', 'pending'], ['101', 'Daily clean', 'Hoa', '09:00', 'done']]
  },
  issues: {
    title: 'Room issues', sub: 'Maintenance reports', action: 'Report issue',
    cols: ['Room', 'Issue', 'Reported by', 'Priority', 'Status'],
    rows: [['408', 'Air conditioner leaking', 'Hoa', 'high', 'open'], ['210', 'TV remote missing', 'Lan', 'low', 'open'], ['603', 'Broken lamp', 'Mai', 'medium', 'resolved']]
  },
  invoices: {
    title: 'Invoices', sub: 'Room charges, services and taxes', action: 'Create invoice',
    cols: ['Invoice', 'Booking', 'Guest', 'Amount', 'Status'],
    rows: [['INV-2201', 'BK-1031', 'Hoang Em', '$340', 'paid'], ['INV-2202', 'BK-1038', 'Pham Dung', '$640', 'pending'], ['INV-2203', 'BK-1043', 'Tran Binh', '$300', 'pending']]
  },
  payments: {
    title: 'Payments', sub: 'Deposits and settlements', action: 'Record payment',
    cols: ['Ref', 'Booking', 'Method', 'Amount', 'Status'],
    rows: [['PAY-881', 'BK-1042', 'Card', '$75', 'paid'], ['PAY-882', 'BK-1031', 'Cash', '$340', 'paid'], ['PAY-883', 'BK-1044', 'Bank transfer', '$20', 'pending']]
  },
  refunds: {
    title: 'Refunds', sub: 'Cancellation refunds', action: 'New refund',
    cols: ['Refund', 'Booking', 'Reason', 'Amount', 'Status'],
    rows: [['RF-31', 'BK-1029', 'Guest cancelled', '$70', 'pending'], ['RF-30', 'BK-1012', 'Overbooked', '$120', 'paid']]
  },
  reviews: {
    title: 'Reviews', sub: 'Guest feedback', action: '',
    cols: ['Guest', 'Room type', 'Rating', 'Comment', 'Status'],
    rows: [['Nguyen An', 'Deluxe Double', '★★★★★', 'Spotless and quiet.', 'published'], ['Hoang Em', 'Deluxe Double', '★★★☆☆', 'Slow check-in.', 'pending']]
  }
};

const u = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=70`;
export const ROOM_TYPES = [
  { id: 1, name: 'Deluxe Double', cat: 'standard', bed: 'King bed', size: 32, guests: 2, price: 85, rating: 4.7, img: u('photo-1631049307264-da0ec9d70304'), amenities: ['Free WiFi', 'Breakfast included', 'Air conditioning', 'Smart TV'], desc: 'A calm, light-filled room with a king bed and a work desk, ideal for couples and business travellers.' },
  { id: 2, name: 'Superior Twin', cat: 'standard', bed: '2 single beds', size: 28, guests: 2, price: 70, rating: 4.5, img: u('photo-1590490360182-c33d57733427'), amenities: ['Free WiFi', 'City view', 'Air conditioning'], desc: 'Two comfortable single beds with a city view. A smart pick for friends or colleagues.' },
  { id: 3, name: 'Family Suite', cat: 'suite', bed: '2 queen beds', size: 55, guests: 4, price: 150, rating: 4.8, img: u('photo-1578683010236-d716f9a3f461'), amenities: ['Free WiFi', 'Breakfast included', 'Kitchenette', 'Balcony'], desc: 'Space for the whole family with two queen beds, a lounge area and a private balcony.' },
  { id: 4, name: 'Presidential Suite', cat: 'suite', bed: 'King bed', size: 90, guests: 3, price: 320, rating: 4.9, img: u('photo-1582719478250-c89cae4dc85b'), amenities: ['Free WiFi', 'Breakfast included', 'Jacuzzi', 'Ocean view'], desc: 'Our finest room: panoramic ocean view, jacuzzi and a separate living room.' }
];
export const EXTRAS = [['Airport pickup', 25], ['Breakfast buffet', 12], ['Laundry', 8], ['Spa massage', 40]];
export const OFFERS = [
  { code: 'WELCOME10', title: 'Welcome offer', text: '10% off your first booking.', pct: 10 },
  { code: 'LONGSTAY15', title: 'Long stay', text: '15% off stays of 5 nights or more.', pct: 15 },
  { code: 'WEEKDAY5', title: 'Midweek escape', text: '5% off Sunday to Thursday.', pct: 5 }
];
export const REVIEWS = [
  ['Nguyen An', 5, 'Spotless room and super friendly staff. Check-in took two minutes.'],
  ['Sarah K.', 5, 'Great location, amazing breakfast. Will come back.'],
  ['Tran Binh', 4, 'Family suite was spacious. The kids loved the balcony.']
];
export const MY_BOOKINGS = [
  { code: 'BK-1042', room: 'Deluxe Double', dates: '20 Nov – 23 Nov 2026', total: 255, status: 'confirmed', img: ROOM_TYPES[0].img },
  { code: 'BK-1017', room: 'Family Suite', dates: '02 Sep – 05 Sep 2026', total: 450, status: 'checked_out', img: ROOM_TYPES[2].img },
  { code: 'BK-0990', room: 'Superior Twin', dates: '11 Aug – 12 Aug 2026', total: 70, status: 'cancelled', img: ROOM_TYPES[1].img }
];
