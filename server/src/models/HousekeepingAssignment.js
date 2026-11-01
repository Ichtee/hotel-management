const mongoose = require("mongoose");
const { Schema } = mongoose;

const schema = new Schema({
  staffId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  shift: { type: String, enum: ["morning", "afternoon", "night"], required: true },
  roomIds: [{ type: Schema.Types.ObjectId, ref: "Room" }],
  floors: [Number],
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date, required: true },
  assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  isActive: { type: Boolean, default: true },
  revokedAt: Date,
  revokedBy: { type: Schema.Types.ObjectId, ref: "User" },
  revocationReason: String,
}, { timestamps: true, collection: "housekeeping_assignments" });

// Kiểm tra phạm vi và thời gian của kế hoạch trách nhiệm.
function validateAssignment() {
  if (!this.roomIds.length && !this.floors.length)
    this.invalidate("roomIds", "Select at least one room or floor.");
  if (this.effectiveTo < this.effectiveFrom)
    this.invalidate("effectiveTo", "End date must not precede start date.");
}
schema.pre("validate", validateAssignment);
schema.index({ staffId: 1, isActive: 1, effectiveTo: 1 });
schema.index({ isActive: 1, shift: 1, effectiveFrom: 1, effectiveTo: 1 });

module.exports = mongoose.model("HousekeepingAssignment", schema);
