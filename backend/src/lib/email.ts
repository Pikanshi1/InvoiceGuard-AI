import crypto from "node:crypto";

type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return value.replace(/[&<>"']/g, (character) => replacements[character]);
}

function configured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GOOGLE_SENDER_EMAIL
  );
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function escapeHeader(value: string) {
  return value.replace(/[\r\n]/g, " ").trim();
}

function buildMime(message: EmailMessage) {
  const boundary = `invoiceguard-${crypto.randomBytes(12).toString("hex")}`;
  const headers = [
    `From: InvoiceGuard AI <${escapeHeader(process.env.GOOGLE_SENDER_EMAIL ?? "")}>`,
    `To: ${escapeHeader(message.to)}`,
    `Subject: ${escapeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ].join("\r\n");
  return [
    headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.html,
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

async function gmailAccessToken() {
  if (!configured()) throw new Error("Gmail OAuth2 email delivery is not configured.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error("Gmail OAuth2 token refresh failed.");
  const result = await response.json() as { access_token?: string };
  if (!result.access_token) throw new Error("Gmail OAuth2 token response was incomplete.");
  return result.access_token;
}

export async function sendGmailMessage(message: EmailMessage) {
  const token = await gmailAccessToken();
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(buildMime(message)) }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error("Gmail rejected the email.");
  return response.json() as Promise<{ id?: string; threadId?: string }>;
}

export function gmailConfigured() {
  return configured();
}

const shell = (title: string, body: string, actionUrl: string, actionLabel: string) => `<!doctype html>
<html><body style="margin:0;background:#07111f;color:#e2e8f0;font-family:Arial,sans-serif">
<div style="max-width:620px;margin:40px auto;padding:32px;border:1px solid #1e3a5f;border-radius:18px;background:#0b1626">
<h1 style="margin:0 0 12px;color:#67e8f9">InvoiceGuard AI</h1>
<h2 style="margin:0 0 20px;color:#fff">${title}</h2>
<p style="line-height:1.6;color:#cbd5e1">${body}</p>
<p><a href="${actionUrl}" style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:10px;background:#67e8f9;color:#07111f;text-decoration:none;font-weight:700">${actionLabel}</a></p>
<p style="font-size:12px;color:#64748b;margin-top:28px">If you did not request this, you can safely ignore this email.</p>
</div></body></html>`;

export async function sendVerificationEmail(to: string, name: string, verificationUrl: string, expiresInHours: number) {
  return sendGmailMessage({
    to,
    subject: "Verify your InvoiceGuard AI email",
    html: shell("Verify your email", `Hi ${escapeHtml(name)}, please verify your email address. This link expires in ${expiresInHours} hours.`, verificationUrl, "Verify email"),
    text: `Hi ${name}, verify your InvoiceGuard AI email here: ${verificationUrl}\nThis link expires in ${expiresInHours} hours.`
  });
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string, expiresInMinutes: number) {
  return sendGmailMessage({
    to,
    subject: "Reset your InvoiceGuard AI password",
    html: shell("Reset your password", `Hi ${escapeHtml(name)}, use the secure link below to choose a new password. This link expires in ${expiresInMinutes} minutes.`, resetUrl, "Reset password"),
    text: `Hi ${name}, reset your InvoiceGuard AI password here: ${resetUrl}\nThis link expires in ${expiresInMinutes} minutes.`
  });
}

export async function sendInvitationEmail(to: string, name: string, workspaceName: string, invitationUrl: string, expiresInDays: number) {
  return sendGmailMessage({
    to,
    subject: `You're invited to ${workspaceName} on InvoiceGuard AI`,
    html: shell("Workspace invitation", `Hello ${escapeHtml(name)}, you have been invited to join ${escapeHtml(workspaceName)} on InvoiceGuard AI. The invitation expires in ${expiresInDays} days.`, invitationUrl, "Accept invitation"),
    text: `You have been invited to join ${workspaceName} on InvoiceGuard AI. Accept here: ${invitationUrl}\nThis invitation expires in ${expiresInDays} days.`
  });
}
