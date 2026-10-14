const CleaningTask = require('../models/CleaningTask');
const RoomIssue = require('../models/RoomIssue');
const Room = require('../models/Room');

class HousekeepingService {
  /**
   * ==========================================
   * UC39: MANAGE CLEANING TASKS
   * ==========================================
   */

  /**
   * Get all cleaning tasks with optional filters
   */
  async getCleaningTasks(filter = {}) {
    const query = {};
    if (filter.status) query.status = filter.status;
    if (filter.assignedTo) query.assignedTo = filter.assignedTo;
    if (filter.roomId) query.roomId = filter.roomId;

    return CleaningTask.find(query)
      .populate('roomId', 'roomNumber floor status')
      .populate('assignedTo', 'username email')
      .sort({ scheduledDate: -1, createdAt: -1 });
  }

  /**
   * Create a new cleaning task
   * Automatically ensures room status is marked as 'cleaning'
   */
  async createCleaningTask(data) {
    const room = await Room.findById(data.roomId);
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }

    const task = new CleaningTask({
      roomId: data.roomId,
      assignedTo: data.assignedTo,
      scheduledDate: data.scheduledDate || new Date(),
      notes: data.notes,
      status: 'pending'
    });

    const savedTask = await task.save();

    // Transition room to 'cleaning' if not already
    if (room.status !== 'cleaning') {
      await Room.findByIdAndUpdate(data.roomId, { status: 'cleaning' });
    }

    return savedTask;
  }

  /**
   * Update task status: pending -> in_progress -> done
   * When 'done': Sets completedAt and resets Room status to 'available'
   */
  async updateCleaningTaskStatus(taskId, status) {
    const valid = ['pending', 'in_progress', 'done'];
    if (!valid.includes(status)) {
      const error = new Error(`Invalid status: ${status}. Must be one of: ${valid.join(', ')}`);
      error.status = 400;
      throw error;
    }

    const task = await CleaningTask.findById(taskId);
    if (!task) {
      const error = new Error('Cleaning task not found');
      error.status = 404;
      throw error;
    }

    task.status = status;
    if (status === 'done') {
      task.completedAt = new Date();
      // CRITICAL LIFECYCLE: Room is now clean and available
      await Room.findByIdAndUpdate(task.roomId, { status: 'available' });
    }

    await task.save();
    return task.populate('roomId assignedTo');
  }

  /**
   * ==========================================
   * UC40: REPORT ROOM ISSUE & MAINTENANCE
   * ==========================================
   */

  /**
   * Get all room issues with optional filters
   */
  async getRoomIssues(filter = {}) {
    const query = {};
    if (filter.status) query.status = filter.status;
    if (filter.severity) query.severity = filter.severity;
    if (filter.roomId) query.roomId = filter.roomId;

    return RoomIssue.find(query)
      .populate('roomId', 'roomNumber floor status')
      .populate('reportedBy', 'username email')
      .populate('resolvedBy', 'username email')
      .sort({ createdAt: -1 });
  }

  /**
   * Report an issue with a room
   * If severity is 'high', room status transitions to 'maintenance'
   */
  async createRoomIssue(data) {
    const room = await Room.findById(data.roomId);
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }

    const issue = new RoomIssue({
      roomId: data.roomId,
      reportedBy: data.reportedBy,
      title: data.title,
      description: data.description,
      severity: data.severity || 'medium',
      status: 'open'
    });

    const saved = await issue.save();

    // Critical rule: High severity issue marks room as 'maintenance'
    if (issue.severity === 'high') {
      await Room.findByIdAndUpdate(data.roomId, { status: 'maintenance' });
    }

    return saved;
  }

  /**
   * Resolve an issue
   * Optionally updates room status back to 'cleaning' or 'available'
   */
  async resolveRoomIssue(issueId, { resolvedBy, returnRoomStatus = 'cleaning' }) {
    const issue = await RoomIssue.findById(issueId);
    if (!issue) {
      const error = new Error('Room issue not found');
      error.status = 404;
      throw error;
    }

    issue.status = 'resolved';
    issue.resolvedBy = resolvedBy;
    issue.resolvedAt = new Date();
    await issue.save();

    // Check if there are other open/high issues on this room before releasing maintenance
    const otherIssues = await RoomIssue.countDocuments({
      _id: { $ne: issueId },
      roomId: issue.roomId,
      status: { $in: ['open', 'in_progress'] },
      severity: 'high'
    });

    if (otherIssues === 0) {
      // No more high severity issues, restore room to returnRoomStatus ('cleaning' or 'available')
      await Room.findByIdAndUpdate(issue.roomId, { status: returnRoomStatus });
    }

    return issue.populate('roomId reportedBy resolvedBy');
  }
}

module.exports = new HousekeepingService();
