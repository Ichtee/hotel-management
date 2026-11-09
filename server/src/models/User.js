const mongoose = require('mongoose');
const { Schema } = mongoose;
const userSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true, index: true },
  phone: String,
  status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
  blacklistReason: String,
  blacklistedAt: Date,
  lastLogin: Date,
  passwordReset: { tokenHash: { type: String, select: false }, expiresAt: Date },
  isVerified: { type: Boolean, default: false },
  emailVerification: {
    tokenHash: { type: String, select: false },
    expiresAt: { type: Date, select: false },
    lastSentAt: { type: Date, select: false },
    sentAt: { type: [Date], select: false } // BR-42: the verification e-mails of the last hour, at most 3
  },
  pendingEmail: { type: String, lowercase: true, trim: true }, // UC03 4b: new e-mail waiting for its link
  consentAt: Date, // CR-21: time of the privacy consent
  authVersion: { type: Number, default: 0, select: false },
  // BR-42: 5 consecutive failed logins lock the account for 15 minutes.
  failedLogins: { type: Number, default: 0, select: false, alias: 'failedLoginAttempts' },
  lockedUntil: { type: Date, default: null, select: false, alias: 'lockUntil' },
  mustChangePassword: { type: Boolean, default: false },
  statusReason: { type: String, trim: true, maxlength: 500 },
  customerProfile: { fullName: String, address: String, dateOfBirth: Date, loyaltyPoints: { type: Number, default: 0, min: 0 }, idDocumentNo: { type: String, select: false } },
  employeeProfile: { position: String, hireDate: Date, shift: String }
}, { timestamps: true });
module.exports = mongoose.model('User', userSchema);
