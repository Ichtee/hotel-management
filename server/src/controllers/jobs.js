const { createHash, timingSafeEqual } = require("node:crypto");
const v = require("../utils/validation");
const { jobs } = require("../services/jobs");
const digest = (s) => createHash("sha256").update(String(s)).digest();
// Chạy tác vụ từ cron qua header X-Job-Secret; tắt endpoint nếu chưa có JOB_SECRET.
async function run(req, res) {
  const secret = process.env.JOB_SECRET;
  if (!secret || !Object.hasOwn(jobs, req.params.name)) throw new v.HttpError(404, "Endpoint not found.");
  if (!timingSafeEqual(digest(req.get("X-Job-Secret") || ""), digest(secret))) throw new v.HttpError(401, "Invalid job secret.");
  res.json({ data: await jobs[req.params.name](new Date()) });
}
module.exports = { run };
