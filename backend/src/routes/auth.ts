import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { bcrypt, createSession, deleteSession, getSessionUser, hashSessionToken, SESSION_COOKIE, sessionCookieOptions } from "../lib/auth";
import { readCookie } from "../lib/cookies";
import crypto from "node:crypto";
import { sendPasswordResetEmail, sendVerificationEmail, gmailConfigured } from "../lib/email";
import { Prisma } from "@prisma/client";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email().transform(value => value.toLowerCase()),
  password: z.string().min(12),
  name: z.string().trim().min(2).max(100),
  workspaceName: z.string().trim().min(2).max(100)
});
const publicUser = (user: { id: string; email: string; name: string; avatarUrl: string | null; emailVerified: boolean; memberships: unknown[] }) => ({
  id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, emailVerified: user.emailVerified, memberships: user.memberships
});
const resetTokenExpiryMs = 60 * 60 * 1000;
const verificationTokenExpiryMs = 24 * 60 * 60 * 1000;

async function createVerificationToken(userId: string, email: string, name: string) {
  await prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } });
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + verificationTokenExpiryMs) }
  });
  if (!gmailConfigured()) throw new Error("Gmail OAuth2 email delivery is not configured.");
  try {
    await sendVerificationEmail(email, name, `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/verify-email?token=${encodeURIComponent(token)}`, 24);
  } catch (error) {
    await prisma.emailVerificationToken.deleteMany({ where: { userId, tokenHash: hashSessionToken(token) } });
    throw error;
  }
  return token;
}

authRouter.get("/setup/status", async (_req, res, next) => {
  try {
    const userCount = await prisma.user.count();
    res.json({ setupRequired: userCount === 0 });
  } catch (error) { next(error); }
});

authRouter.post("/setup", async (req, res, next) => {
  try {
    if (!gmailConfigured()) return res.status(503).json({ error: "Gmail OAuth2 email delivery must be configured before initial setup." });
    const data = credentialsSchema.parse(req.body);
    const { user, verificationToken } = await prisma.$transaction(
  async (tx: Prisma.TransactionClient) => {
      const userCount = await tx.user.count();
      if (userCount > 0) throw Object.assign(new Error("Initial setup has already been completed."), { code: "SETUP_COMPLETE" });
      const slug = `${data.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
      const passwordHash = await bcrypt.hash(data.password, 12);
      const created = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          name: data.name,
          memberships: { create: { role: "OWNER", workspace: { create: { name: data.workspaceName, slug } } } }
        },
        include: { memberships: { include: { workspace: true } } }
      });
      const token = crypto.randomBytes(32).toString("base64url");
      await tx.emailVerificationToken.create({ data: { userId: created.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + verificationTokenExpiryMs) } });
      return { user: created, verificationToken: token };
    }, { isolationLevel: "Serializable" });
    const session = await createSession(user.id);
    try {
      await sendVerificationEmail(user.email, user.name, `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/verify-email?token=${encodeURIComponent(verificationToken)}`, 24);
    } catch {
      await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, tokenHash: hashSessionToken(verificationToken) } });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      return res.status(503).json({ error: "Account was created, but verification email delivery failed. Please contact an administrator." });
    }
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    res.status(201).json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const data = z.object({ email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email }, include: { memberships: { include: { workspace: true } } } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) return res.status(401).json({ error: "Invalid email or password." });
    const session = await createSession(user.id);
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    await deleteSession(readCookie(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    res.status(204).send();
  } catch (error) { next(error); }
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const user = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!user) return res.status(401).json({ error: "Authentication required." });
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

authRouter.post("/verify-email", async (req, res, next) => {
  try {
    const data = z.object({ token: z.string().min(20) }).parse(req.body);
    const token = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashSessionToken(data.token) } });
    if (!token || token.usedAt || token.expiresAt <= new Date()) return res.status(400).json({ error: "This verification link is invalid or expired." });
    const consumed = await prisma.$transaction(
  async (tx: Prisma.TransactionClient) => {
      const result = await tx.emailVerificationToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (result.count !== 1) return false;
      await tx.user.update({ where: { id: token.userId }, data: { emailVerified: true } });
      return true;
    });
    if (!consumed) return res.status(400).json({ error: "This verification link is invalid or expired." });
    res.json({ message: "Email verified successfully." });
  } catch (error) { next(error); }
});

authRouter.post("/resend-verification", async (req, res, next) => {
  try {
    if (!gmailConfigured()) return res.status(503).json({ error: "Gmail OAuth2 email delivery is not configured." });
    const user = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!user) return res.status(401).json({ error: "Authentication required." });
    if (user.emailVerified) return res.json({ message: "Email is already verified." });
    await createVerificationToken(user.id, user.email, user.name);
    res.json({ message: "Verification email sent." });
  } catch (error) { next(error); }
});

authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const data = z.object({ email: z.string().email().transform(value => value.toLowerCase()) }).parse(req.body);
    if (!gmailConfigured()) return res.status(503).json({ error: "Password reset is temporarily unavailable. Please try again later." });
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (user) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      const resetToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = hashSessionToken(resetToken);
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + resetTokenExpiryMs) }
      });
      const resetUrl = `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/reset-password?token=${encodeURIComponent(resetToken)}`;
      try {
        await sendPasswordResetEmail(user.email, user.name, resetUrl, 60);
      } catch {
        await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, tokenHash } });
        console.warn("Password reset email delivery failed.");
      }
    }
    res.status(202).json({
      message: "If an account exists for that email, reset instructions will be sent. If delivery is temporarily unavailable, please try again later."
    });
  } catch (error) { next(error); }
});

authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const data = z.object({ token: z.string().min(20), password: z.string().min(12) }).parse(req.body);
    const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashSessionToken(data.token) } });
    if (!token || token.usedAt || token.expiresAt <= new Date()) return res.status(400).json({ error: "This reset link is invalid or expired." });
    const passwordHash = await bcrypt.hash(data.password, 12);
    const consumed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const result = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (result.count !== 1) return false;
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: token.userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId: token.userId, id: { not: token.id } } });
      return true;
    });
    if (!consumed) return res.status(400).json({ error: "This reset link is invalid or expired." });
    res.json({ message: "Password updated. You can now sign in." });
  } catch (error) { next(error); }
});

authRouter.patch("/profile", async (req, res, next) => {
  try {
    const currentUser = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!currentUser) return res.status(401).json({ error: "Authentication required." });
    const data = z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().email().transform(value => value.toLowerCase()),
      avatarUrl: z.string().url().max(2048).nullable().optional()
    }).parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing && existing.id !== currentUser.id) return res.status(409).json({ error: "That email is already in use." });
    const emailChanged = data.email !== currentUser.email;
    if (emailChanged && !gmailConfigured()) return res.status(503).json({ error: "Email changes require Gmail OAuth2 delivery to be configured." });
    const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.user.update({
        where: { id: currentUser.id },
        data: { name: data.name, email: data.email, avatarUrl: data.avatarUrl ?? null, ...(emailChanged ? { emailVerified: false } : {}) },
        include: { memberships: { include: { workspace: true } } }
      });
      if (emailChanged) {
        const token = crypto.randomBytes(32).toString("base64url");
        await tx.emailVerificationToken.deleteMany({ where: { userId: updated.id, usedAt: null } });
        await tx.emailVerificationToken.create({ data: { userId: updated.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + verificationTokenExpiryMs) } });
        (updated as typeof updated & { verificationToken?: string }).verificationToken = token;
      }
      return updated;
    });
    if (emailChanged) {
      const token = (user as typeof user & { verificationToken?: string }).verificationToken!;
      await sendVerificationEmail(user.email, user.name, `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/verify-email?token=${encodeURIComponent(token)}`, 24);
      await prisma.session.deleteMany({ where: { userId: currentUser.id } });
      return res.status(401).json({ error: "Email changed. Verify the new email before signing in again." });
    }
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

authRouter.post("/change-password", async (req, res, next) => {
  try {
    const currentUser = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!currentUser) return res.status(401).json({ error: "Authentication required." });
    const data = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: currentUser.id } });
    if (!user || !(await bcrypt.compare(data.currentPassword, user.passwordHash))) return res.status(400).json({ error: "Current password is incorrect." });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(data.newPassword, 12) } }),
      prisma.session.deleteMany({ where: { userId: user.id } })
    ]);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    res.json({ message: "Password changed. Please sign in again." });
  } catch (error) { next(error); }
});
