const router = require('express').Router();
const controller = require('../controllers/customer.controller');
const { requireActor } = require('../middleware/actor');

router.use(requireActor);
router.get('/', controller.list);
router.get('/:customerId', controller.getOne);
router.patch('/:customerId', controller.update);

module.exports = router;
