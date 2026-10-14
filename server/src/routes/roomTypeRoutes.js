const express = require('express');
const router = express.Router();
const roomTypeController = require('../controllers/roomTypeController');

// Public customer routes (UC04, UC05, UC06)
router.get('/', roomTypeController.getAll);
router.get('/:id', roomTypeController.getById);
router.get('/:id/price-on-date', roomTypeController.getPriceForDate);

// Management routes (UC31, UC32)
router.post('/', roomTypeController.create);
router.put('/:id', roomTypeController.update);
router.delete('/:id', roomTypeController.delete);
router.put('/:id/pricing', roomTypeController.updatePricing);

module.exports = router;
