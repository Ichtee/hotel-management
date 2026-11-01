const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');
const { appError } = require('../utils/http');

const isId = value => mongoose.isObjectIdOrHexString(value);
const CUSTOMER_FIELDS = 'username email phone status customerProfile.fullName customerProfile.address customerProfile.dateOfBirth customerProfile.loyaltyPoints createdAt updatedAt';
const EDITABLE_FIELDS = new Set(['fullName', 'phone', 'address', 'dateOfBirth', 'idDocumentNo']);

async function customerRoleId() {
  const role = await Role.findOne({ key: 'customer', isActive: true }).select('_id');
  if (!role) throw appError('Customer role is not configured', 500);
  return role._id;
}

function pageOptions(query) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit };
}

exports.listCustomers = async query => {
  const { page, limit } = pageOptions(query);
  const filter = { roleId: await customerRoleId() };
  if (query.status) {
    if (!['active', 'suspended', 'deleted'].includes(query.status)) throw appError('Invalid customer status');
    filter.status = query.status;
  } else filter.status = { $ne: 'deleted' };
  const search = String(query.search || '').trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escaped, 'i');
    filter.$or = [{ username: expression }, { email: expression }, { phone: expression }, { 'customerProfile.fullName': expression }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).select(CUSTOMER_FIELDS).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter)
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

exports.getCustomer = async customerId => {
  if (!isId(customerId)) throw appError('Invalid customer ID');
  const customer = await User.findOne({ _id: customerId, roleId: await customerRoleId() }).select(`${CUSTOMER_FIELDS} +customerProfile.idDocumentNo`).lean();
  if (!customer) throw appError('Customer not found', 404);
  return customer;
};

exports.updateCustomer = async (customerId, payload) => {
  if (!isId(customerId)) throw appError('Invalid customer ID');
  const unknown = Object.keys(payload).filter(key => !EDITABLE_FIELDS.has(key));
  if (unknown.length) throw appError(`These fields cannot be updated here: ${unknown.join(', ')}`);
  if (!Object.keys(payload).length) throw appError('At least one customer field is required');
  if (payload.dateOfBirth !== undefined && (Number.isNaN(new Date(payload.dateOfBirth).valueOf()) || new Date(payload.dateOfBirth) > new Date())) throw appError('dateOfBirth must be a valid date in the past');
  if (payload.phone !== undefined && typeof payload.phone !== 'string') throw appError('phone must be a string');
  const changes = {};
  for (const field of ['fullName', 'address', 'dateOfBirth', 'idDocumentNo']) if (payload[field] !== undefined) changes[`customerProfile.${field}`] = payload[field] || undefined;
  if (payload.phone !== undefined) changes.phone = payload.phone.trim() || undefined;
  const customer = await User.findOneAndUpdate(
    { _id: customerId, roleId: await customerRoleId() }, { $set: changes }, { new: true, runValidators: true }
  ).select(`${CUSTOMER_FIELDS} +customerProfile.idDocumentNo`).lean();
  if (!customer) throw appError('Customer not found', 404);
  return customer;
};
