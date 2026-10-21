const Hotel = require('../models/Hotel');
const RoomType = require('../models/RoomType');
const Room = require('../models/Room');
const Role = require('../models/Role');
const User = require('../models/User');
const crypto = require('crypto');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password || 'default123').digest('hex');
}

async function seedDefaultsIfNeeded() {
  try {
    // ── 1. Seed Roles ─────────────────────────────────────────────────────
    const roleConfigs = [
      { key: 'admin',      name: 'Administrator', isSystem: true,  permissions: ['*'] },
      { key: 'manager',    name: 'Hotel Manager',  isSystem: true,  permissions: ['manage_rooms', 'manage_bookings', 'manage_staff', 'view_reports'] },
      { key: 'receptionist', name: 'Receptionist', isSystem: true,  permissions: ['manage_bookings', 'check_in', 'check_out', 'view_rooms'] },
      { key: 'housekeeper',  name: 'Housekeeper',  isSystem: true,  permissions: ['manage_housekeeping', 'update_room_status'] },
      { key: 'customer',   name: 'Customer',        isSystem: false, permissions: ['make_booking', 'view_own_bookings', 'update_profile'] }
    ];

    const roleMap = {};
    for (const cfg of roleConfigs) {
      let role = await Role.findOne({ key: cfg.key });
      if (!role) {
        role = await Role.create(cfg);
        console.log(`[Seed] Created role: ${cfg.name}`);
      }
      roleMap[cfg.key] = role;
    }

    // ── 2. Seed Admin account ─────────────────────────────────────────────
    const adminEmail = 'admin@grandstay.example';
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      await User.create({
        username: 'admin',
        email: adminEmail,
        passwordHash: hashPassword('Admin@123'),
        roleId: roleMap['admin']._id,
        phone: '+84 236 3888 000',
        status: 'active',
        employeeProfile: {
          position: 'System Administrator',
          hireDate: new Date('2025-01-01')
        }
      });
      console.log('[Seed] Created default admin account:');
      console.log('       Email   : admin@grandstay.example');
      console.log('       Password: Admin@123');
    }

    // ── 3. Seed Hotel & Rooms ─────────────────────────────────────────────
    const roomCount = await Room.countDocuments();
    if (roomCount > 0) return;

    console.log('[Seed] Database is empty. Seeding initial hotel, room types, and rooms for Member 2...');

    let hotel = await Hotel.findOne({ name: 'GrandStay Da Nang' });
    if (!hotel) {
      hotel = await Hotel.create({
        name: 'GrandStay Da Nang',
        address: '123 Vo Nguyen Giap, My Khe Beach',
        city: 'Da Nang',
        starRating: 5,
        phone: '+84 236 3888 999',
        email: 'hello@grandstay.example'
      });
    }

    const typeConfigs = [
      {
        name: 'Deluxe Double',
        basePrice: 85,
        maxOccupancy: 2,
        bedType: 'King bed',
        roomSizeSqm: 32,
        amenities: ['Ocean view balcony', 'Rain shower', 'Smart TV', 'Free high-speed WiFi', 'Espresso machine'],
        images: ['https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80'],
        description: 'Wake up to panoramic ocean views from your private balcony. Premium king bed, Italian marble bathroom.'
      },
      {
        name: 'Superior Twin',
        basePrice: 70,
        maxOccupancy: 2,
        bedType: '2 Single beds',
        roomSizeSqm: 28,
        amenities: ['City view', 'Work desk', 'Walk-in shower', 'Free high-speed WiFi'],
        images: ['https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=900&q=80'],
        description: 'Two plush single beds with crisp percale linens, ergonomic work desk, and high-speed Wi-Fi.'
      },
      {
        name: 'Family Suite',
        basePrice: 150,
        maxOccupancy: 4,
        bedType: '2 Queen beds',
        roomSizeSqm: 55,
        amenities: ['Connecting living area', 'Deep soaking tub', 'Kitchenette', 'Free high-speed WiFi'],
        images: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80'],
        description: 'Generous two-queen suite designed for traveling families or small groups. Separate seating lounge.'
      },
      {
        name: 'Presidential Suite',
        basePrice: 320,
        maxOccupancy: 4,
        bedType: 'King + Queen',
        roomSizeSqm: 90,
        amenities: ['Private terrace & plunge pool', 'Dining room for 6', 'Butler service', 'Jacuzzi'],
        images: ['https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=900&q=80'],
        description: 'The pinnacle of luxury living. Expansive rooftop terrace with plunge pool and panoramic coastal vistas.'
      }
    ];

    const createdTypes = [];
    for (const conf of typeConfigs) {
      let rt = await RoomType.findOne({ hotelId: hotel._id, name: conf.name });
      if (!rt) {
        rt = await RoomType.create({ hotelId: hotel._id, ...conf });
      }
      createdTypes.push(rt);
    }

    // Create 16 physical rooms across 4 floors
    const roomsToCreate = [];
    for (let floor = 1; floor <= 4; floor++) {
      for (let rNum = 1; rNum <= 4; rNum++) {
        const typeIndex = (floor + rNum - 2) % createdTypes.length;
        const rt = createdTypes[typeIndex];
        const roomNumber = `${floor}0${rNum}`;
        const existing = await Room.findOne({ hotelId: hotel._id, roomNumber });
        if (!existing) {
          roomsToCreate.push({
            hotelId: hotel._id,
            roomTypeId: rt._id,
            roomNumber,
            floor,
            status: 'available',
            isActive: true
          });
        }
      }
    }

    if (roomsToCreate.length > 0) {
      await Room.insertMany(roomsToCreate);
    }

    console.log(`[Seed] Successfully seeded ${createdTypes.length} room types and ${roomsToCreate.length} rooms!`);
  } catch (err) {
    console.warn('[Seed Warning] Auto-seeding skipped or failed:', err.message);
  }
}

module.exports = seedDefaultsIfNeeded;

    if (roomCount > 0) return;

    console.log('[Seed] Database is empty. Seeding initial hotel, room types, and rooms for Member 2...');

    let hotel = await Hotel.findOne({ name: 'GrandStay Da Nang' });
    if (!hotel) {
      hotel = await Hotel.create({
        name: 'GrandStay Da Nang',
        address: '123 Vo Nguyen Giap, My Khe Beach',
        city: 'Da Nang',
        starRating: 5,
        phone: '+84 236 3888 999',
        email: 'hello@grandstay.example'
      });
    }

    const typeConfigs = [
      {
        name: 'Deluxe Double',
        basePrice: 85,
        maxOccupancy: 2,
        bedType: 'King bed',
        roomSizeSqm: 32,
        amenities: ['Ocean view balcony', 'Rain shower', 'Smart TV', 'Free high-speed WiFi', 'Espresso machine'],
        images: ['https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80'],
        description: 'Wake up to panoramic ocean views from your private balcony. Premium king bed, Italian marble bathroom.'
      },
      {
        name: 'Superior Twin',
        basePrice: 70,
        maxOccupancy: 2,
        bedType: '2 Single beds',
        roomSizeSqm: 28,
        amenities: ['City view', 'Work desk', 'Walk-in shower', 'Free high-speed WiFi'],
        images: ['https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=900&q=80'],
        description: 'Two plush single beds with crisp percale linens, ergonomic work desk, and high-speed Wi-Fi.'
      },
      {
        name: 'Family Suite',
        basePrice: 150,
        maxOccupancy: 4,
        bedType: '2 Queen beds',
        roomSizeSqm: 55,
        amenities: ['Connecting living area', 'Deep soaking tub', 'Kitchenette', 'Free high-speed WiFi'],
        images: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80'],
        description: 'Generous two-queen suite designed for traveling families or small groups. Separate seating lounge.'
      },
      {
        name: 'Presidential Suite',
        basePrice: 320,
        maxOccupancy: 4,
        bedType: 'King + Queen',
        roomSizeSqm: 90,
        amenities: ['Private terrace & plunge pool', 'Dining room for 6', 'Butler service', 'Jacuzzi'],
        images: ['https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=900&q=80'],
        description: 'The pinnacle of luxury living. Expansive rooftop terrace with plunge pool and panoramic coastal vistas.'
      }
    ];

    const createdTypes = [];
    for (const conf of typeConfigs) {
      let rt = await RoomType.findOne({ hotelId: hotel._id, name: conf.name });
      if (!rt) {
        rt = await RoomType.create({ hotelId: hotel._id, ...conf });
      }
      createdTypes.push(rt);
    }

    // Create 16 physical rooms across 4 floors
    const roomsToCreate = [];
    for (let floor = 1; floor <= 4; floor++) {
      for (let rNum = 1; rNum <= 4; rNum++) {
        const typeIndex = (floor + rNum - 2) % createdTypes.length;
        const rt = createdTypes[typeIndex];
        const roomNumber = `${floor}0${rNum}`;
        const existing = await Room.findOne({ hotelId: hotel._id, roomNumber });
        if (!existing) {
          roomsToCreate.push({
            hotelId: hotel._id,
            roomTypeId: rt._id,
            roomNumber,
            floor,
            status: 'available',
            isActive: true
          });
        }
      }
    }

    if (roomsToCreate.length > 0) {
      await Room.insertMany(roomsToCreate);
    }

    console.log(`[Seed] Successfully seeded ${createdTypes.length} room types and ${roomsToCreate.length} rooms!`);
  } catch (err) {
    console.warn('[Seed Warning] Auto-seeding skipped or failed:', err.message);
  }
}

module.exports = seedDefaultsIfNeeded;
