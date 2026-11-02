const service = require('../services/customer.service');
const { asyncHandler } = require('../utils/http');

exports.list = asyncHandler(async (req, res) => res.json(await service.listCustomers(req.query)));
exports.getOne = asyncHandler(async (req, res) => res.json({ customer: await service.getCustomer(req.params.customerId) }));
exports.update = asyncHandler(async (req, res) => res.json({ customer: await service.updateCustomer(req.params.customerId, req.body) }));
