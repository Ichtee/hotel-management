const express = require('express');
const router = express.Router();
const roomTypeController = require('../controllers/roomTypeController');

// Public customer routes (UC06)
router.get('/:id/price-on-date', roomTypeController.getPriceForDate);

// Management routes (UC32)
router.put('/:id/pricing', roomTypeController.updatePricing);

module.exports = router;
