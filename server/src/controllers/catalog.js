const Service = require("../models/Service");
const CompensationItem = require("../models/CompensationItem");
const v = require("../utils/validation");
const { audit } = require("../services/audit");

// UC34: the Hotel Manager keeps two catalogs. There is no delete: an entry already used on a booking is only
// deactivated, and amounts already recorded never change (BR-19, BR-43).
const catalogs = {
  services: { Model: Service, price: "unitPrice", min: 0 },
  "compensation-items": { Model: CompensationItem, price: "price", min: 1 },
};
const pick = (req) => catalogs[req.params.catalog] || (() => { throw new v.HttpError(404, "Unknown catalog."); })();
function input(body, c, creating) {
  v.keys(body, ["name", "price", "isActive", "category", "description"]);
  const data = {};
  if (creating || body.name !== undefined) data.name = v.text(body.name, "name", 1, 120);
  if (creating || body.price !== undefined) data[c.price] = v.number(body.price, "price", c.min, 1e9);
  if (body.isActive !== undefined) data.isActive = v.boolean(body.isActive, "isActive");
  if (c.Model === Service) for (const k of ["category", "description"]) if (body[k] !== undefined) data[k] = v.text(body[k], k, 0, 300);
  return data;
}
const duplicate = (e) => { if (e.code === 11000) throw new v.HttpError(409, "An entry with this name already exists."); throw e; };

async function listing(req, res) {
  const c = pick(req);
  const data = await c.Model.find().sort({ isActive: -1, name: 1 }).lean();
  res.json({ data: data.map((d) => ({ ...d, price: d[c.price] })) });
}
async function create(req, res) {
  const c = pick(req);
  const doc = await c.Model.create(input(req.body, c, true)).catch(duplicate);
  await audit(req.user._id, "catalog.created", req.params.catalog, doc._id, { name: doc.name, price: doc[c.price] });
  res.status(201).json({ data: { ...doc.toObject(), price: doc[c.price] } });
}
async function update(req, res) {
  const c = pick(req);
  const doc = await c.Model.findByIdAndUpdate(v.id(req.params.id), { $set: input(req.body, c, false) }, { new: true, runValidators: true }).catch(duplicate);
  if (!doc) throw new v.HttpError(404, "Entry not found.");
  await audit(req.user._id, "catalog.updated", req.params.catalog, doc._id, { name: doc.name, price: doc[c.price], isActive: doc.isActive });
  res.json({ data: { ...doc.toObject(), price: doc[c.price] } });
}
module.exports = { listing, create, update };
