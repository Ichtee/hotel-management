const { runHousekeepingTick } = require("./housekeepingTasks");

// Chạy lịch mỗi 30 giây, tránh chồng lượt và dừng trước khi đóng database.
function startHousekeepingScheduler() {
  let stopped = false;
  let running = null;
  const tick = () => {
    if (stopped || running) return;
    running = runHousekeepingTick().catch((error) => {
      console.error("Housekeeping scheduler tick failed:", error?.message || error);
    }).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
module.exports = { startHousekeepingScheduler };
