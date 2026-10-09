const User = require("../models/User");
const Role = require("../models/Role");
const Hotel = require("../models/Hotel");
const v = require("../utils/validation");
const { hashPassword } = require("../utils/password");
const safe = (user) => {
  const data = user.toObject();
  delete data.passwordHash;
  delete data.authVersion;
  if (data.customerProfile) delete data.customerProfile.idDocumentNo;
  return data;
};
const staffRoles = ["receptionist", "housekeeping"];
async function roleFor(key, requireActive = true) {
  const role = await Role.findOne({
    key,
    ...(requireActive ? { isActive: true } : {}),
  });
  if (!role) v.fail("Select an active role.", "role");
  return role;
}
async function hotelFor(id) {
  v.id(id, "hotelId");
  if (!(await Hotel.exists({ _id: id })))
    v.fail("Select an existing hotel.", "hotelId");
  return id;
}
function editable(body, isStaff, creating) {
  const allowed = [
    "fullName",
    "email",
    "phone",
    "role",
    "status",
    "position",
    "shift",
    "hireDate",
  ];
  if (!isStaff) allowed.push("hotelId");
  if (creating) allowed.push("username", "password");
  v.keys(body, allowed);
  const out = {};
  if (creating) {
    out.username = v.username(body.username);
    v.password(body.password);
  }
  if (creating || body.fullName !== undefined)
    out.fullName = v.text(body.fullName, "fullName", 2, 50);
  if (creating || body.email !== undefined) out.email = v.email(body.email);
  if (creating || body.phone !== undefined)
    out.phone = v.phone(body.phone, isStaff);
  if (body.status !== undefined)
    out.status = v.choice(body.status, "status", [
      "active",
      "suspended",
      "deleted",
    ]);
  if (body.role !== undefined) out.role = v.text(body.role, "role", 2, 40);
  for (const field of ["position", "shift"])
    if (body[field] !== undefined)
      out[field] = v.text(body[field], field, 0, 100);
  if (body.hireDate !== undefined)
    out.hireDate = body.hireDate ? v.date(body.hireDate, "hireDate") : null;
  return out;
}
function apply(user, data) {
  for (const key of ["username", "email", "phone", "role", "status"])
    if (data[key] !== undefined) user[key] = data[key];
  if (data.fullName !== undefined)
    user.customerProfile.fullName = data.fullName;
  for (const key of ["position", "shift", "hireDate", "hotelId"])
    if (data[key] !== undefined) user.employeeProfile[key] = data[key];
}
function checkEmployment(body, role) {
  if (role.scope !== "hotel") {
    for (const field of ["position", "shift", "hireDate"])
      if (body[field] !== undefined)
        v.fail("Employment details require a hotel role.", field);
  }
}
const listing = (isStaff) => async (req, res) => {
  const regex = v.search(req.query);
  const filter = {
    $or: [
      { username: regex },
      { email: regex },
      { "customerProfile.fullName": regex },
    ],
  };
  if (isStaff) {
    filter["employeeProfile.hotelId"] = req.hotelId;
    filter.role = { $in: staffRoles };
  }
  if (req.query.status)
    filter.status = v.choice(req.query.status, "status", [
      "active",
      "suspended",
      "deleted",
    ]);
  if (req.query.role)
    filter.role = isStaff
      ? v.choice(req.query.role, "role", staffRoles)
      : v.text(req.query.role, "role", 2, 40);
  res.json(await v.list(User, filter, req.query));
};
const create = (isStaff) => async (req, res) => {
  const data = editable(req.body, isStaff, true);
  const role = await roleFor(data.role || "customer");
  checkEmployment(req.body, role);
  data.role = role.key;
  if (isStaff) {
    v.choice(data.role, "role", staffRoles);
    data.hotelId = req.hotelId;
  } else if (role.scope === "hotel")
    data.hotelId = await hotelFor(req.body.hotelId);
  else if (req.body.hotelId)
    v.fail("This role does not use a hotel assignment.", "hotelId");
  if (role.scope === "hotel") data.phone = v.phone(req.body.phone, true);
  const user = new User({
    passwordHash: await hashPassword(req.body.password),
  });
  apply(user, data);
  await user.save();
  res.status(201).json({ data: safe(user) });
};
const update = (isStaff) => async (req, res) => {
  const data = editable(req.body, isStaff, false);
  const filter = { _id: v.id(req.params.id) };
  if (isStaff) {
    filter["employeeProfile.hotelId"] = req.hotelId;
    filter.role = { $in: staffRoles };
  }
  const user = await User.findOne(filter).select("+authVersion");
  if (!user) throw new v.HttpError(404, "Account not found.");
  if (
    user.role === "admin" &&
    ((data.role && data.role !== "admin") ||
      (data.status && data.status !== "active"))
  )
    throw new v.HttpError(
      409,
      "Administrator accounts cannot be demoted or deactivated here.",
    );
  if (isStaff && data.role) v.choice(data.role, "role", staffRoles);
  const role = await roleFor(
    data.role || user.role,
    Boolean(data.role && data.role !== user.role),
  );
  checkEmployment(req.body, role);
  if (isStaff) data.hotelId = req.hotelId;
  else if (role.scope === "hotel")
    data.hotelId = await hotelFor(
      req.body.hotelId || user.employeeProfile?.hotelId?.toString(),
    );
  else {
    if (req.body.hotelId)
      v.fail("This role does not use a hotel assignment.", "hotelId");
    user.employeeProfile = undefined;
  }
  if (role.scope === "hotel") v.phone(data.phone ?? user.phone, true);
  if (
    (data.role && data.role !== user.role) ||
    (data.status && data.status !== user.status) ||
    (data.hotelId &&
      String(data.hotelId) !== String(user.employeeProfile?.hotelId))
  )
    user.authVersion = (user.authVersion || 0) + 1;
  apply(user, data);
  await user.save();
  res.json({ data: safe(user) });
};
async function deactivateStaff(req, res) {
  req.body = { status: "suspended" };
  return update(true)(req, res);
}
async function options(req, res) {
  const hotels =
    req.role.scope === "system"
      ? await Hotel.find().select("name city").sort({ name: 1 }).lean()
      : await Hotel.find({ _id: req.user.employeeProfile?.hotelId })
          .select("name city")
          .lean();
  const roles = await Role.find({
    isActive: true,
    ...(req.role.scope === "system" ? {} : { key: { $in: staffRoles } }),
  })
    .select("key name scope")
    .lean();
  res.json({ data: { hotels, roles } });
}
module.exports = { listing, create, update, deactivateStaff, options };
