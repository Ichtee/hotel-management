const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Public routes (customer)
router.post('/register', authController.register);
router.post('/login', authController.login);
router.put('/profile', authController.updateProfile);
router.put('/password', authController.changePassword);

// Admin-only routes — require x-admin-secret header
router.post('/staff', authController.createStaff);
router.get('/staff', authController.listStaff);
router.put('/staff/:id', authController.updateStaff);
router.post('/staff/:id/reset-password', authController.resetStaffPassword);

module.exports = router;

