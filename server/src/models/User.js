const mongoose = require('mongoose');
const { Schema } = mongoose;
const userSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, required: true, default: 'customer', lowercase: true, trim: true },
  phone: String,
  status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
  lastLogin: Date,
  passwordReset: { tokenHash: { type: String, select: false }, expiresAt: Date }, // Forgot Password (UC02)
  authVersion: { type: Number, default: 0, select: false },
  customerProfile: { fullName: String, address: String, dateOfBirth: Date, loyaltyPoints: { type: Number, default: 0, min: 0 }, idDocumentNo: { type: String, select: false } },
  employeeProfile: { position: String, hireDate: Date, shift: String }
}, { timestamps: true });
module.exports = mongoose.model('User', userSchema);
