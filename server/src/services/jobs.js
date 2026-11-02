const { autoApprove } = require("./cancellations");
const { reconcileDaily } = require("./payments");
const { processNoShows } = require("./noShows");
// SDS 1.3 scheduled jobs owned by M3. Each one is idempotent and catches up on everything overdue.
const jobs = {
  "cancellation-auto-approval": autoApprove, // job 02, every 5 minutes (BR-36)
  "payment-reconciliation": reconcileDaily, // job 07, 04:15 daily
  "no-show-processing": processNoShows, // T11, 06:00 daily
};
const run = (name) => jobs[name](new Date()).catch((e) => console.error(`Job ${name} failed:`, e.message));
// In-process timers; POST /api/jobs/:name lets an external cron trigger the same jobs when the server sleeps.
function schedule() {
  setInterval(() => run("cancellation-auto-approval"), 5 * 60000).unref();
  run("cancellation-auto-approval"); // catch up after downtime
  // 04:15 in Asia/Ho_Chi_Minh (UTC+7, no daylight saving) is 21:15 UTC.
  const untilNext = () => {
    const t = new Date();
    t.setUTCHours(21, 15, 0, 0);
    if (t <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
    return t - Date.now();
  };
  const daily = () => setTimeout(() => run("payment-reconciliation").then(daily), untilNext()).unref();
  daily();
  // 06:00 in Asia/Ho_Chi_Minh = 23:00 UTC on the prior day.
  const untilNoShow = () => {
    const t = new Date(); t.setUTCHours(23, 0, 0, 0);
    if (t <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
    return t - Date.now();
  };
  const noShowDaily = () => setTimeout(() => run("no-show-processing").then(noShowDaily), untilNoShow()).unref();
  noShowDaily();
}
module.exports = { jobs, schedule };
