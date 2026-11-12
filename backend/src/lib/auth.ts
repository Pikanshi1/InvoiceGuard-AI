import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const SESSION_COOKIE = "invoiceguard_session";
const SESSION_DAYS = 7;

export function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createSession(userId: string) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { tokenHash: hashSessionToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { include: { memberships: { include: { workspace: true } } } } }
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }
  return session.user;
}

export async function deleteSession(token: string | undefined) {
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/"
  };
}

export { bcrypt };
