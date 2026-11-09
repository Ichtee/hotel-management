require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const nodemailer = require('nodemailer');

async function testEmail() {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/["'\s]/g, '');
  console.log('--- Testing Gmail SMTP Connection ---');
  console.log('SMTP_USER:', user);
  console.log('SMTP_PASS length:', pass.length);

  if (!user || !pass) {
    console.error('ERROR: SMTP_USER or SMTP_PASS is empty in server/.env');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  try {
    console.log('Verifying SMTP credentials with Google...');
    await transporter.verify();
    console.log('SUCCESS: Gmail credentials verified!');

    const target = process.argv[2] || 'sondnqhe180515@fpt.edu.vn';
    console.log(`Sending test email to: ${target}...`);

    const info = await transporter.sendMail({
      from: `"GrandStay Hotel" <${user}>`,
      to: target,
      subject: 'GrandStay - Test Verification Email',
      text: 'Your verification code is: 999888. It expires in 15 minutes.',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0f2742;">GrandStay Hotel & Resorts</h2>
          <p>This is a real test verification email sent from your GrandStay server.</p>
          <div style="background: #f1f5f9; padding: 15px; text-align: center; border-radius: 6px; margin: 20px 0;">
            <span style="font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #0284c7;">999888</span>
          </div>
          <p style="color: #64748b; font-size: 13px;">If you see this, your Gmail SMTP configuration is 100% working!</p>
        </div>
      `,
    });
    console.log('EMAIL SENT SUCCESSFULLY!');
    console.log('Message ID:', info.messageId);
    console.log('Recipient:', target);
  } catch (err) {
    console.error('SMTP Error:', err.message);
    if (err.response) console.error('Google SMTP Response:', err.response);
  }
}

testEmail();

