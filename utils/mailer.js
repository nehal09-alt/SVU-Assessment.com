function getEmailConfig() {
  const port = Number(process.env.SMTP_PORT || "587");
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  let pass = (process.env.SMTP_PASS || "").trim();

  // Gmail app passwords are shown with spaces (e.g. "abcd efgh ijkl mnop").
  // Normalize to continuous token before SMTP auth.
  if (host.toLowerCase().includes("gmail")) {
    pass = pass.replace(/\s+/g, "");
  }

  const defaultFrom = user ? `SVU Assessment.com <${user}>` : "";
  return {
    host,
    port,
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    user,
    pass,
    from: process.env.SMTP_FROM || defaultFrom,
  };
}

let cachedTransporter = null;
let cachedTransportKey = "";

function isEmailConfigured() {
  const cfg = getEmailConfig();
  const hasBasics = Boolean(cfg.host && cfg.port && cfg.user && cfg.pass && cfg.from);
  const hasPlaceholderUser = cfg.user.toLowerCase().includes("your_email@gmail.com");
  const hasPlaceholderPass = cfg.pass.toLowerCase().includes("your_app_password");
  return hasBasics && !hasPlaceholderUser && !hasPlaceholderPass;
}

function createTransporter() {
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (err) {
    throw new Error("nodemailer package is not installed");
  }

  const cfg = getEmailConfig();
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
}

function getTransporter() {
  const cfg = getEmailConfig();
  const nextKey = JSON.stringify({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    pass: cfg.pass,
  });

  if (!cachedTransporter || cachedTransportKey !== nextKey) {
    cachedTransporter = createTransporter();
    cachedTransportKey = nextKey;
  }

  return cachedTransporter;
}

function getEmailHealth() {
  const cfg = getEmailConfig();
  return {
    configured: isEmailConfigured(),
    host: cfg.host || "",
    port: cfg.port || "",
    secure: Boolean(cfg.secure),
    from: cfg.from || "",
    userHint: cfg.user ? cfg.user.replace(/^(.{2}).*(@.*)$/, "$1***$2") : "",
  };
}

async function sendOtpEmail(to, otp) {
  try {
    const cfg = getEmailConfig();
    const transporter = getTransporter();

    const subject = "SVU Password Reset OTP";
    const text = `Your SVU password reset OTP is ${otp}. It will expire in 5 minutes. If you did not request this, please ignore this email.`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
        <h2 style="margin-bottom: 8px;">SVU Password Reset</h2>
        <p>Your OTP is:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 3px;">${otp}</p>
        <p>This OTP will expire in <strong>5 minutes</strong>.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `;

    const result = await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text,
      html,
    });
    return result;
  } catch (err) {
    console.error(`Failed to send OTP email to ${to}:`, err.message);
    throw err;
  }
}

module.exports = {
  isEmailConfigured,
  getEmailHealth,
  sendOtpEmail,
};
