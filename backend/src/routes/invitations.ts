import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { readCookie } from "../lib/cookies";
import { Prisma } from "@prisma/client";

export const invitationRouter = Router();

invitationRouter.post("/:token/accept", async (req, res, next) => {
  try {
    const user = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!user) return res.status(401).json({ error: "Sign in with the invited email before accepting this invitation." });
    const tokenHash = crypto.createHash("sha256").update(String(req.params.token)).digest("hex");
    const invitation = await prisma.invitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) return res.status(400).json({ error: "Invitation is invalid, expired, or already used." });
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) return res.status(403).json({ error: "This invitation was issued to a different email address." });
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const currentUser = await tx.user.findUnique({ where: { id: user.id }, select: { email: true } });
      if (!currentUser || currentUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw Object.assign(new Error("Invitation email no longer matches the authenticated account."), { code: "INVITATION_INVALID" });
      }
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, tokenHash, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() }
      });
      if (claimed.count !== 1) throw Object.assign(new Error("Invitation is invalid, expired, or already used."), { code: "INVITATION_INVALID" });
      await tx.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: invitation.workspaceId } },
        create: { userId: user.id, workspaceId: invitation.workspaceId, role: invitation.role },
        update: {}
      });
    }, { isolationLevel: "Serializable" });
    res.json({ accepted: true, workspaceId: invitation.workspaceId });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["INVITATION_INVALID", "P2034", "P2002"].includes(String((error as { code?: string }).code))) {
      return res.status(409).json({ error: "Invitation is invalid, expired, or already used." });
    }
    next(error);
  }
});
