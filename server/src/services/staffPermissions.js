const editableRoles = ["receptionist", "housekeeping"];
const receptionist = ["receptionist"];
const housekeeping = ["housekeeping"];
const both = editableRoles;
const definitions = [
  ["rooms.search", "Search Room", receptionist],
  ["rooms.filter", "Filter Room", receptionist],
  ["rooms.details.read", "View Room Details", receptionist],
  ["bookings.walk_in.create", "Create Booking for Walk-in Customer", receptionist],
  ["bookings.managed.read", "View Managed Booking", receptionist],
  ["bookings.managed.update", "Modify Managed Booking", receptionist],
  ["bookings.managed.cancel", "Cancel Managed Booking", receptionist],
  ["cancellations.review", "Review Cancellation Request", receptionist],
  ["stay_requests.manage", "Handle Check-in / Check-out Request", receptionist],
  ["stays.check_in", "Check-in", receptionist],
  ["stays.check_out", "Check-out", receptionist],
  ["rooms.assign", "Assign Room", receptionist],
  ["rooms.change", "Change Room", receptionist],
  ["booking_services.record", "Record Additional Services", receptionist],
  ["penalties.record", "Record Damage / Loss Penalty", receptionist],
  ["invoices.print", "Print Invoice", receptionist],
  ["refunds.handle", "Handle Booking Refund", receptionist],
  ["payments.settle", "Settle Total Payment at Check-out", receptionist],
  ["payments.status.read", "View Payment / Booking Payment Status", receptionist],
  ["coupons.apply", "Apply Coupon", receptionist],
  ["reviews.read", "View Reviews", receptionist],
  ["notifications.read", "View / Receive Notification", both],
  ["cleaning_tasks.own.read", "View Own Assigned Tasks", housekeeping],
  ["cleaning_tasks.status.update", "Update Cleaning Status", housekeeping],
  ["cleaning_tasks.ad_hoc.create", "Create Ad-hoc Cleaning Request", receptionist],
  ["room_issues.report", "Report Room Issue", both],
  ["damages.report", "Report Damage", housekeeping],
];

// Ánh xạ quyền nghiệp vụ theo bảng phân quyền; luôn giữ quyền tài khoản cá nhân.
function permissionEntry([key, name, defaultRoles]) {
  return { key, name, scope: "hotel", defaultRoles };
}
const staffPermissionCatalog = definitions.map(permissionEntry);
const allowedStaffPermissions = new Set(staffPermissionCatalog.map((p) => p.key));

// Lấy quyền mặc định theo vai trò; quản lý có thể cấp quyền trong phạm vi hai vai trò nhân viên.
function defaultStaffPermissions(roleKey) {
  return staffPermissionCatalog.filter((p) => p.defaultRoles.includes(roleKey)).map((p) => p.key);
}

module.exports = { editableRoles, staffPermissionCatalog, allowedStaffPermissions, defaultStaffPermissions };
