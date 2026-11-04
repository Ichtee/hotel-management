const { Resend } = require("resend");

let resendInstance = null;

function getResendClient() {
  if (resendInstance) return resendInstance;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  resendInstance = new Resend(apiKey);
  return resendInstance;
}

// For unit testing
function setResendClient(client) {
  resendInstance = client;
}

function getSender() {
  return process.env.RESEND_FROM_EMAIL || "GrandStay <onboarding@resend.dev>";
}

function getClientUrl() {
  return (
    process.env.CLIENT_URL ||
    process.env.CLIENT_ORIGIN ||
    "http://localhost:5173"
  ).replace(/\/+$/, "");
}

function buildVerificationHtml({ fullName, verificationUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - GrandStay</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f6f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #172033;
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      background-color: #f4f6f9;
      padding: 40px 0;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
      border: 1px solid #e0e5ec;
    }
    .header {
      background-color: #0f2742;
      padding: 32px 40px;
      text-align: center;
    }
    .brand {
      color: #ffffff;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
      text-decoration: none;
      display: inline-block;
    }
    .brand span {
      color: #c8923b;
    }
    .content {
      padding: 40px 40px 32px;
    }
    h1 {
      margin-top: 0;
      font-size: 22px;
      font-weight: 700;
      color: #0f2742;
    }
    p {
      margin: 0 0 18px;
      font-size: 15px;
      color: #334155;
    }
    .btn-container {
      text-align: center;
      margin: 32px 0;
    }
    .btn {
      display: inline-block;
      background-color: #0f2742;
      color: #ffffff !important;
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      padding: 14px 34px;
      border-radius: 8px;
      border: 1px solid #0f2742;
      letter-spacing: 0.2px;
    }
    .notice {
      background-color: #fff9ed;
      border-left: 4px solid #c8923b;
      padding: 14px 16px;
      border-radius: 4px;
      font-size: 13px;
      color: #8a5300;
      margin: 24px 0 0;
    }
    .fallback {
      margin-top: 24px;
      font-size: 12px;
      color: #64748b;
      word-break: break-all;
    }
    .footer {
      background-color: #fafbfc;
      border-top: 1px solid #e0e5ec;
      padding: 24px 40px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="brand">Grand<span>Stay</span></div>
      </div>
      <div class="content">
        <h1>Verify your email address</h1>
        <p>Hello <strong>${fullName || "there"}</strong>,</p>
        <p>Thank you for signing up with <strong>GrandStay Hotel</strong>. To complete your registration and secure your account, please verify your email address.</p>
        <div class="btn-container">
          <a href="${verificationUrl}" class="btn" target="_blank">Verify Email</a>
        </div>
        <div class="notice">
          ⏱ <strong>Important:</strong> This verification link will expire in <strong>15 minutes</strong>.
        </div>
        <div class="fallback">
          If the button above does not work, copy and paste this link into your browser:<br>
          <a href="${verificationUrl}" style="color: #1b4f9c;">${verificationUrl}</a>
        </div>
      </div>
      <div class="footer">
        <p style="margin: 0;">If you did not create an account with GrandStay, you can safely ignore this email.</p>
        <p style="margin: 8px 0 0;">&copy; 2026 GrandStay Hotel Management. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send an email verification link via Resend.
 * @param {Object} options
 * @param {string} options.email - Recipient email
 * @param {string} options.fullName - Recipient display name
 * @param {string} options.token - Raw verification token
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string, simulated?: boolean }>}
 */
async function sendVerificationEmail({ email, fullName, token }) {
  const clientUrl = getClientUrl();
  const verificationUrl = `${clientUrl}/#/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
  const resend = getResendClient();

  if (!resend) {
    console.warn(
      `[Resend] RESEND_API_KEY is not configured. Email to ${email} was skipped.\n` +
      `[Resend] Local verification URL: ${verificationUrl}`
    );
    return { success: false, simulated: true, verificationUrl };
  }

  try {
    const from = getSender();
    const result = await resend.emails.send({
      from,
      to: email,
      subject: "GrandStay - Verify your email address",
      html: buildVerificationHtml({ fullName, verificationUrl }),
    });

    if (result.error) {
      console.error("[Resend] API Error:", result.error);
      console.log(`[Resend] Local verification URL fallback: ${verificationUrl}`);
      return { success: false, error: result.error.message || String(result.error), verificationUrl };
    }

    console.log(`[Resend] Verification email sent to ${email} (ID: ${result.data?.id})`);
    return { success: true, messageId: result.data?.id };
  } catch (err) {
    console.error("[Resend] Unexpected send error:", err.message);
    console.log(`[Resend] Local verification URL fallback: ${verificationUrl}`);
    return { success: false, error: err.message, verificationUrl };
  }
}

module.exports = {
  sendVerificationEmail,
  setResendClient,
  getResendClient,
  getClientUrl,
};
