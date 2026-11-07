const Service = require("../models/Service");
const v = require("../utils/validation");
const { hotelTransaction } = require("../services/hotelOperations");
const { logChange } = require("../services/audit");

function catalog(kind) {
  if (!["services", "compensation-items"].includes(kind))
    throw new v.HttpError(404, "Catalog not found.");
  return kind === "services"
    ? { kind: { $ne: "compensation" } }
    : { kind: "compensation" };
}

async function list(req, res) {
  const filter = {
    ...catalog(req.params.kind),
    ...(req.role.key === "manager" ? {} : { isActive: true }),
  };
  res.json({ data: await Service.find(filter).sort({ name: 1 }).lean() });
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
  const filter = catalog(req.params.kind);
  const data = await hotelTransaction(async (session) => {
    const item = creating
      ? new Service({
          ...input,
          kind: req.params.kind === "services" ? "service" : "compensation",
        })
      : await Service.findOne({ _id: v.id(req.params.id), ...filter }).session(
          session,
        );
    if (!item) throw new v.HttpError(404, "Catalog item not found.");
    if (
      await Service.exists({
        ...filter,
        name: input.name ?? item.name,
        _id: { $ne: item._id },
      }).session(session)
    )
      throw new v.HttpError(
        409,
        "A catalog item with this name already exists.",
      );
    Object.assign(item, input);
    await item.save({ session });
    await logChange(
      req,
      creating ? "catalog.created" : "catalog.updated",
      "Service",
      item._id,
      input,
      session,
    );
    return item;
  });
  res.status(creating ? 201 : 200).json({ data });
}

module.exports = { list, save };
