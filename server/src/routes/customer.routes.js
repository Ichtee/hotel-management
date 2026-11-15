const router = require('express').Router();
const controller = require('../controllers/customer.controller');

// Gắn sau xác thực và kiểm tra quyền lễ tân trong app.js.
router.get('/', controller.list);
router.get('/:customerId', controller.getOne);
router.patch('/:customerId', controller.update);

module.exports = router;
