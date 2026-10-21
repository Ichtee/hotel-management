const crypto = require('crypto');
const User = require('../models/User');
const Role = require('../models/Role');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password || 'default123').digest('hex');
}

// Simple admin-only guard: check header x-admin-secret or req.body.adminSecret
// In production this should be replaced with JWT-based role verification
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'grandstay_admin_2026';
function requireAdmin(req) {
  const secret = req.headers['x-admin-secret'] || req.body?.adminSecret;
  if (!secret || secret !== ADMIN_SECRET) {
    const err = new Error('Admin access required. Invalid or missing admin credentials.');
    err.status = 403;
    throw err;
  }
}

class AuthController {
  async register(req, res, next) {
    try {
      const { fullName, email, password, phone } = req.body;
      if (!email || !password) {
        const error = new Error('Email and password are required');
        error.status = 400;
        throw error;
      }

      const cleanEmail = email.toLowerCase().trim();
      const existing = await User.findOne({ email: cleanEmail });
      if (existing) {
        const error = new Error('An account with this email already exists');
        error.status = 409;
        throw error;
      }

      let customerRole = await Role.findOne({ key: 'customer' });
      if (!customerRole) {
        customerRole = await Role.findOne({});
      }
      const roleId = customerRole ? customerRole._id : new User()._id;

      const user = new User({
        username: cleanEmail.split('@')[0] + '_' + Math.floor(100 + Math.random() * 900),
        email: cleanEmail,
        passwordHash: hashPassword(password),
        roleId,
        phone: phone || '',
        status: 'active',
        customerProfile: {
          fullName: fullName || cleanEmail.split('@')[0],
          loyaltyPoints: 100 // Welcome points
        }
      });

      await user.save();

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: {
          id: user._id,
          email: user.email,
          fullName: user.customerProfile?.fullName,
          phone: user.phone,
          loyaltyPoints: user.customerProfile?.loyaltyPoints || 0
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        const error = new Error('Email and password are required');
        error.status = 400;
        throw error;
      }

      const cleanEmail = email.toLowerCase().trim();
      const user = await User.findOne({ email: cleanEmail }).select('+passwordHash');
      if (!user) {
        const error = new Error('Account not found with this email');
        error.status = 401;
        throw error;
      }

      const hash = hashPassword(password);
      if (user.passwordHash && user.passwordHash !== hash && !user.passwordHash.startsWith('guest_')) {
        const error = new Error('Incorrect password');
        error.status = 401;
        throw error;
      }

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          id: user._id,
          email: user.email,
          fullName: user.customerProfile?.fullName || user.username,
          phone: user.phone,
          loyaltyPoints: user.customerProfile?.loyaltyPoints || 0
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const { id, email, fullName, phone, address, newPassword } = req.body;
      const query = {};
      if (id) {
        query._id = id;
      } else if (email) {
        query.email = email.toLowerCase().trim();
      } else {
        const error = new Error('User ID or email is required to update profile');
        error.status = 400;
        throw error;
      }

      const user = await User.findOne(query);
      if (!user) {
        const error = new Error('User account not found');
        error.status = 404;
        throw error;
      }

      user.customerProfile = user.customerProfile || {};
      if (fullName) user.customerProfile.fullName = fullName;
      if (address !== undefined) user.customerProfile.address = address;
      if (phone !== undefined) user.phone = phone;
      if (newPassword && newPassword.length >= 6) {
        user.passwordHash = hashPassword(newPassword);
      }

      await user.save();

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          id: user._id,
          email: user.email,
          fullName: user.customerProfile?.fullName,
          phone: user.phone,
          address: user.customerProfile?.address,
          loyaltyPoints: user.customerProfile?.loyaltyPoints || 0
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req, res, next) {
    try {
      const { id, email, currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        const error = new Error('Current password and new password are required');
        error.status = 400;
        throw error;
      }
      if (newPassword.length < 6) {
        const error = new Error('New password must be at least 6 characters');
        error.status = 400;
        throw error;
      }

      const query = {};
      if (id) query._id = id;
      else if (email) query.email = email.toLowerCase().trim();
      else {
        const error = new Error('User ID or email is required');
        error.status = 400;
        throw error;
      }

      const user = await User.findOne(query).select('+passwordHash');
      if (!user) {
        const error = new Error('User account not found');
        error.status = 404;
        throw error;
      }

      const currentHash = hashPassword(currentPassword);
      if (user.passwordHash && user.passwordHash !== currentHash && !user.passwordHash.startsWith('guest_')) {
        const error = new Error('Current password is incorrect');
        error.status = 401;
        throw error;
      }

      user.passwordHash = hashPassword(newPassword);
      await user.save();

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  // Admin-only: create a staff account
  async createStaff(req, res, next) {
    try {
      requireAdmin(req);

      const { fullName, email, password, phone, roleKey, position, shift } = req.body;

      if (!email || !password || !fullName) {
        const error = new Error('Full name, email and password are required');
        error.status = 400;
        throw error;
      }
      if (password.length < 6) {
        const error = new Error('Password must be at least 6 characters');
        error.status = 400;
        throw error;
      }

      const cleanEmail = email.toLowerCase().trim();
      const existing = await User.findOne({ email: cleanEmail });
      if (existing) {
        const error = new Error('An account with this email already exists');
        error.status = 409;
        throw error;
      }

      // Find the target role (default to 'receptionist' if not provided)
      const targetRoleKey = roleKey || 'receptionist';
      let role = await Role.findOne({ key: targetRoleKey });
      if (!role) {
        // Try to find any staff role
        role = await Role.findOne({ key: { $in: ['staff', 'employee', 'receptionist', 'housekeeping', 'manager'] } });
      }
      if (!role) {
        const error = new Error(`Role '${targetRoleKey}' not found. Please create the role first.`);
        error.status = 400;
        throw error;
      }

      const username = cleanEmail.split('@')[0] + '_' + Math.floor(100 + Math.random() * 900);

      const user = new User({
        username,
        email: cleanEmail,
        passwordHash: hashPassword(password),
        roleId: role._id,
        phone: phone || '',
        status: 'active',
        employeeProfile: {
          position: position || role.name,
          hireDate: new Date(),
          shift: shift || 'morning'
        },
        customerProfile: {
          fullName: fullName
        }
      });

      await user.save();

      res.status(201).json({
        success: true,
        message: `Staff account created successfully for ${fullName}`,
        data: {
          id: user._id,
          username: user.username,
          email: user.email,
          fullName,
          role: role.key,
          roleName: role.name,
          position: user.employeeProfile?.position,
          shift: user.employeeProfile?.shift,
          status: user.status
        }
      });
    } catch (err) {
      next(err);
    }
  }

  // Admin-only: list all staff accounts
  async listStaff(req, res, next) {
    try {
      requireAdmin(req);

      // Get all non-customer roles
      const staffRoles = await Role.find({ key: { $ne: 'customer' } });
      const staffRoleIds = staffRoles.map(r => r._id);

      const staff = await User.find({ roleId: { $in: staffRoleIds } })
        .populate('roleId', 'key name')
        .select('-passwordHash')
        .sort({ createdAt: -1 });

      res.json({
        success: true,
        data: staff.map(u => ({
          id: u._id,
          username: u.username,
          email: u.email,
          fullName: u.customerProfile?.fullName || u.username,
          phone: u.phone,
          role: u.roleId?.key,
          roleName: u.roleId?.name,
          position: u.employeeProfile?.position,
          shift: u.employeeProfile?.shift,
          status: u.status,
          createdAt: u.createdAt
        }))
      });
    } catch (err) {
      next(err);
    }
  }

  // Admin-only: update staff account status or info
  async updateStaff(req, res, next) {
    try {
      requireAdmin(req);

      const { id } = req.params;
      const { status, position, shift, phone, roleKey } = req.body;

      const user = await User.findById(id).populate('roleId', 'key name');
      if (!user) {
        const error = new Error('Staff account not found');
        error.status = 404;
        throw error;
      }

      if (status) user.status = status;
      if (phone !== undefined) user.phone = phone;

      if (position || shift) {
        user.employeeProfile = user.employeeProfile || {};
        if (position) user.employeeProfile.position = position;
        if (shift) user.employeeProfile.shift = shift;
      }

      if (roleKey) {
        const newRole = await Role.findOne({ key: roleKey });
        if (!newRole) {
          const error = new Error(`Role '${roleKey}' not found`);
          error.status = 400;
          throw error;
        }
        user.roleId = newRole._id;
      }

      await user.save();
      await user.populate('roleId', 'key name');

      res.json({
        success: true,
        message: 'Staff account updated',
        data: {
          id: user._id,
          email: user.email,
          fullName: user.customerProfile?.fullName,
          role: user.roleId?.key,
          roleName: user.roleId?.name,
          status: user.status
        }
      });
    } catch (err) {
      next(err);
    }
  }

  // Admin-only: reset staff password
  async resetStaffPassword(req, res, next) {
    try {
      requireAdmin(req);

      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        const error = new Error('New password must be at least 6 characters');
        error.status = 400;
        throw error;
      }

      const user = await User.findById(id);
      if (!user) {
        const error = new Error('Staff account not found');
        error.status = 404;
        throw error;
      }

      user.passwordHash = hashPassword(newPassword);
      await user.save();

      res.json({ success: true, message: 'Staff password reset successfully' });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
