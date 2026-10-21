const mongoose = require("mongoose");
class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
const fail = (message, field, status = 400) => {
  throw new HttpError(
    status,
    message,
    field ? { [field]: message } : undefined,
  );
};
function keys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail("A JSON object is required.");
  const extra = Object.keys(body).find((k) => !allowed.includes(k));
  if (extra) fail(`Field '${extra}' is not allowed.`, extra);
}
function text(value, field, min = 1, max = 120) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    fail(`${field} must be ${min}–${max} characters.`, field);
  return value.trim();
}
function email(value) {
  const v = text(value, "email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    fail("Enter a valid email address.", "email");
  return v;
}
function username(value) {
  const v = text(value, "username", 3, 40).toLowerCase();
  if (!/^[a-z0-9_.-]+$/.test(v))
    fail("Use letters, numbers, dots, hyphens or underscores.", "username");
  return v;
}
function password(value, field = "password") {
  if (
    typeof value !== "string" ||
    value.length < 10 ||
    value.length > 128 ||
    !/[a-zA-Z]/.test(value) ||
    !/\d/.test(value)
  )
    fail("Use 10–128 characters with a letter and a number.", field);
  return value;
}
function phone(value, required = false) {
  if (!required && (value === "" || value === undefined)) return "";
  if (typeof value !== "string" || !/^\d{10,11}$/.test(value))
    fail("Phone must contain 10–11 digits.", "phone");
  return value;
}
function choice(value, field, choices) {
  if (!choices.includes(value)) fail(`Invalid ${field}.`, field);
  return value;
}
function number(value, field, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(`${field} must be an integer between ${min} and ${max}.`, field);
  return value;
}
function boolean(value, field) {
  if (typeof value !== "boolean")
    fail(`${field} must be true or false.`, field);
  return value;
}
function date(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail(`Enter a valid ${field} date.`, field);
  return value;
}
function id(value, field = "id") {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    fail(`Invalid ${field}.`, field);
  return value;
}
function pagination(query) {
  const parse = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value))
      fail("Invalid page or limit.");
    return number(Number(value), "pagination", 1, max);
  };
  return {
    page: parse(query.page, 1, 100000),
    limit: parse(query.limit, 10, 100),
  };
}
function search(query) {
  const value = query.q === undefined ? "" : text(query.q, "search", 0, 100);
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}
async function list(Model, filter, query, projection) {
  const { page, limit } = pagination(query);
  const [data, total] = await Promise.all([
    Model.find(filter)
      .select(projection || "")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Model.countDocuments(filter),
  ]);
  return {
    data,
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}
module.exports = {
  HttpError,
  fail,
  keys,
  text,
  email,
  username,
  password,
  phone,
  choice,
  number,
  boolean,
  date,
  id,
  pagination,
  search,
  list,
};
