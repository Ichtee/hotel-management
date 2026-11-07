const Service = require("../models/Service");
const CompensationItem = require("../models/CompensationItem");
const v = require("../utils/validation");
const { hotelTransaction } = require("../services/hotelOperations");
const { logChange } = require("../services/audit");

function catalog(kind) {
  if (!["services", "compensation-items"].includes(kind))
    throw new v.HttpError(404, "Catalog not found.");
  return kind === "services" ? Service : CompensationItem;
}

async function list(req, res) {
  const Model = catalog(req.params.kind);
  const filter = req.role.key === "manager" ? {} : { isActive: true };
  res.json({ data: await Model.find(filter).sort({ name: 1 }).lean() });
}

async function save(req, res) {
  v.keys(req.body, ["name", "unitPrice", "isActive"]);
  const creating = !req.params.id,
    input = {};
  if (creating || req.body.name !== undefined)
    input.name = v.text(req.body.name, "name", 1, 100);
  if (creating || req.body.unitPrice !== undefined)
    input.unitPrice = v.number(req.body.unitPrice, "unitPrice", 0, 1e12);
  if (req.body.isActive !== undefined)
    input.isActive = v.boolean(req.body.isActive, "isActive");
  const Model = catalog(req.params.kind);
  const data = await hotelTransaction(async (session) => {
    const item = creating
      ? new Model(input)
      : await Model.findById(v.id(req.params.id)).session(session);
    if (!item) throw new v.HttpError(404, "Catalog item not found.");
    Object.assign(item, input);
    await item.save({ session });
    await logChange(
      req,
      creating ? "catalog.created" : "catalog.updated",
      Model.modelName,
      item._id,
      input,
      session,
    );
    return item;
  });
  res.status(creating ? 201 : 200).json({ data });
}

module.exports = { list, save };
