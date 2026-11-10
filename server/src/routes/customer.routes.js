const router = require('express').Router();
const controller = require('../controllers/customer.controller');

// Mounted behind authenticate and the front-desk permissions in app.js.
router.get('/', controller.list);
router.get('/:customerId', controller.getOne);
router.patch('/:customerId', controller.update);

module.exports = router;
