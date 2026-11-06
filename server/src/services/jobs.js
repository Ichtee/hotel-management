const { autoApprove } = require("./cancellations");
const { reconcileDaily } = require("./payments");
// SDS 1.3 scheduled jobs owned by M3. Each one is idempotent and catches up on everything overdue.
const jobs = {
  "cancellation-auto-approval": autoApprove, // job 02, every 5 minutes (BR-36)
  "payment-reconciliation": reconcileDaily, // job 07, 04:15 daily
};
const run = (name) => jobs[name](new Date()).catch((e) => console.error(`Job ${name} failed:`, e.message));
// Next hh:mm in Asia/Ho_Chi_Minh (UTC+7, no daylight saving), e.g. 04:15 is 21:15 UTC.
const untilNext = (hour, minute) => {
  const t = new Date();
  t.setUTCHours((hour + 17) % 24, minute, 0, 0);
  if (t <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
  return t - Date.now();
};
const daily = (name, hour, minute) => setTimeout(() => run(name).then(() => daily(name, hour, minute)), untilNext(hour, minute)).unref();
// In-process timers; POST /api/jobs/:name lets an external cron trigger the same jobs when the server sleeps.
function schedule() {
  setInterval(() => run("cancellation-auto-approval"), 5 * 60000).unref();
  run("cancellation-auto-approval"); // catch up after downtime
  daily("payment-reconciliation", 4, 15);
}
module.exports = { jobs, schedule };
