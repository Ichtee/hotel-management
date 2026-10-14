const express = require('express');
const router = express.Router();
const housekeepingController = require('../controllers/housekeepingController');

// Tasks (UC39)
router.get('/tasks', housekeepingController.getTasks);
router.post('/tasks', housekeepingController.createTask);
router.patch('/tasks/:id/status', housekeepingController.updateTaskStatus);

// Issues (UC40)
router.get('/issues', housekeepingController.getIssues);
router.post('/issues', housekeepingController.createIssue);
router.patch('/issues/:id/resolve', housekeepingController.resolveIssue);

module.exports = router;
