const mongoose = require("mongoose");
class HttpError extends Error {
  constructor(status, message, fields, code) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.code = code;
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
// Mã định danh (số giấy tờ, số tài khoản, mã giảm giá, số phòng...): không tự cắt, không có dấu cách, đúng mẫu.
function code(value, field, pattern, message) {
  if (typeof value !== "string" || /\s/.test(value) || !pattern.test(value)) fail(message, field);
  return value;
}
// Tên người (BR-24): 2–50 ký tự, chữ cái (có dấu), một dấu cách giữa các từ, ' . - ; bỏ dấu cách hai đầu.
function name(value, field = "fullName", min = 2, max = 50) {
  const v = text(value, field, min, max);
  if (/\s{2,}/.test(v)) fail("Use a single space between words.", field);
  if (!/^\p{L}[\p{L}\p{M} .'-]*$/u.test(v)) fail("Use letters only (spaces, ' . - allowed), no digits or symbols.", field);
  return v;
}
// Số CCCD / CMND / hộ chiếu và mã giảm giá dùng ở nhiều nơi.
const idNumber = (value, field = "idDocumentNo") =>
  code(value, field, /^[A-Za-z0-9]{6,20}$/, "ID / passport number: 6–20 letters or digits, no spaces.");
const couponCode = (value, field = "code") =>
  code(value, field, /^[A-Za-z0-9]{2,30}$/, "Coupon code: 2–30 letters or digits, no spaces.").toUpperCase();
function email(value) {
  if (typeof value === "string" && /\s/.test(value)) fail("Email cannot contain spaces.", "email");
  const v = text(value, "email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    fail("Enter a valid email address.", "email");
  return v;
}
function username(value) {
  // Không tự cắt dấu cách: username có dấu cách bị từ chối thay vì lưu bản đã cắt.
  if (typeof value === "string" && /\s/.test(value)) fail("Username cannot contain spaces.", "username");
  const v = text(value, "username", 3, 40).toLowerCase();
  if (!/^[a-z0-9_.-]+$/.test(v))
    fail("Use letters, numbers, dots, hyphens or underscores.", "username");
  return v;
}
function password(value, field = "password") {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 128 ||
    !/[a-z]/.test(value) ||
    !/[A-Z]/.test(value) ||
    !/\d/.test(value)
  )
    fail("Use 8–128 characters with an upper-case letter, a lower-case letter and a number.", field);
  if (/\s/.test(value)) fail("Password cannot contain spaces.", field);
  return value;
}
function phone(value, required = false) {
  if (!required && (value === "" || value === undefined)) return "";
  // Số Việt Nam có 10–11 chữ số; số quốc tế bắt đầu bằng dấu cộng và có 8–15 chữ số.
  if (typeof value !== "string" || !/^(\d{10,11}|\+\d{8,15})$/.test(value))
    fail("Phone number must have 10 to 11 digits, or + and 8 to 15 digits with the country code.", "phone");
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
  code,
  name,
  idNumber,
  couponCode,
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
