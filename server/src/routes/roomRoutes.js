const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');

// Search available rooms (UC05)
router.get('/search', roomController.search);

// Update status (UC40)
router.patch('/:id/status', roomController.updateStatus);

module.exports = router;
