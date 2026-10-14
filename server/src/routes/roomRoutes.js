const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');

// Search available rooms (UC05)
router.get('/search', roomController.search);

// Physical room CRUD (UC30)
router.get('/', roomController.getAll);
router.get('/:id', roomController.getById);
router.post('/', roomController.create);
router.put('/:id', roomController.update);
router.patch('/:id/status', roomController.updateStatus);
router.delete('/:id', roomController.delete);

module.exports = router;
