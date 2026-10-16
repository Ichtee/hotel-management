const HotelPolicy = require("../models/HotelPolicy");
const v = require("../utils/validation");
const { currentDepositPolicy } = require("../services/policies");
async function listing(req, res) {
  const result = await v.list(HotelPolicy, { kind: "deposit" }, req.query);
  result.meta.current = await currentDepositPolicy();
  res.json(result);
}
// UC29: saving creates a new version and retires the old one, so existing bookings keep their snapshot (BR-31).
async function create(req, res) {
  v.keys(req.body, ["percentage", "name", "description"]);
  const percentage = v.number(req.body.percentage, "percentage", 1, 100);
  const now = new Date();
  await HotelPolicy.updateMany({ kind: "deposit", isActive: true }, { isActive: false, effectiveTo: now });
  const policy = await HotelPolicy.create({
    kind: "deposit",
    name: req.body.name === undefined ? `Deposit ${percentage}%` : v.text(req.body.name, "name", 2, 100),
    description: req.body.description === undefined ? undefined : v.text(req.body.description, "description", 0, 500),
    deposit: { type: "percentage", value: percentage },
    effectiveFrom: now,
  });
  res.status(201).json({ data: policy });
}
module.exports = { listing, create };
