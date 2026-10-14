const housekeepingService = require('../services/housekeepingService');

class HousekeepingController {
  // --- Cleaning Tasks (UC39) ---
  async getTasks(req, res, next) {
    try {
      const { status, assignedTo, roomId } = req.query;
      const data = await housekeepingService.getCleaningTasks({ status, assignedTo, roomId });
      res.json({ success: true, count: data.length, data });
    } catch (err) {
      next(err);
    }
  }

  async createTask(req, res, next) {
    try {
      const data = await housekeepingService.createCleaningTask(req.body);
      res.status(201).json({ success: true, message: 'Cleaning task created', data });
    } catch (err) {
      next(err);
    }
  }

  async updateTaskStatus(req, res, next) {
    try {
      const { status } = req.body;
      const data = await housekeepingService.updateCleaningTaskStatus(req.params.id, status);
      res.json({ success: true, message: `Task status changed to ${status}`, data });
    } catch (err) {
      next(err);
    }
  }

  // --- Room Issues & Maintenance (UC40) ---
  async getIssues(req, res, next) {
    try {
      const { status, severity, roomId } = req.query;
      const data = await housekeepingService.getRoomIssues({ status, severity, roomId });
      res.json({ success: true, count: data.length, data });
    } catch (err) {
      next(err);
    }
  }

  async createIssue(req, res, next) {
    try {
      const data = await housekeepingService.createRoomIssue(req.body);
      res.status(201).json({ success: true, message: 'Room issue reported', data });
    } catch (err) {
      next(err);
    }
  }

  async resolveIssue(req, res, next) {
    try {
      const { resolvedBy, returnRoomStatus } = req.body;
      const data = await housekeepingService.resolveRoomIssue(req.params.id, { resolvedBy, returnRoomStatus });
      res.json({ success: true, message: 'Room issue resolved', data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new HousekeepingController();
