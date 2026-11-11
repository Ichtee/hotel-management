// Gửi email qua REST API của EmailJS với bốn khóa cấu hình.
// Mẫu dùng To={{to_email}}, Subject={{subject}}, body={{{html}}}; cho phép gọi ngoài trình duyệt.
const URL = "https://api.emailjs.com/api/v1.0/email/send";
const enabled = () => ["EMAILJS_SERVICE_ID", "EMAILJS_TEMPLATE_ID", "EMAILJS_PUBLIC_KEY", "EMAILJS_PRIVATE_KEY"].every((k) => process.env[k]);
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function sendMail({ to, subject, text = "", html }) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: { to_email: to, subject, message: text, html: html ?? escape(text).replace(/\n/g, "<br>") },
    }),
  });
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${await res.text()}`);
}
module.exports = { enabled, sendMail };
