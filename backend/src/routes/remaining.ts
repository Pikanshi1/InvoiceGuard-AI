import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { requireRole } from "../middleware/workspace";
import { parsePagination, paginate } from "../lib/pagination";

export const remainingRouter = Router();

remainingRouter.post("/workspace/invitations", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const data = z.object({ email: z.string().email().transform(value => value.toLowerCase()), role: z.enum(["ADMIN", "MANAGER", "FINANCE", "EMPLOYEE", "AUDITOR"]).default("EMPLOYEE") }).parse(req.body);
    const { gmailConfigured, sendInvitationEmail } = await import("../lib/email.js");
    if (!gmailConfigured()) return res.status(503).json({ error: "Workspace invitations require configured Gmail OAuth2 delivery." });
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing && await prisma.membership.findFirst({ where: { userId: existing.id, workspaceId: req.workspaceId } })) return res.status(409).json({ error: "This user is already a workspace member." });
    const token = crypto.randomBytes(32).toString("base64url");
    const invitation = await prisma.invitation.create({ data: { workspaceId: req.workspaceId!, email: data.email, role: data.role, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 7 * 86400000), invitedById: req.userId! } });
    const workspace = await prisma.workspace.findUnique({ where: { id: req.workspaceId! }, select: { name: true } });
    try {
      await sendInvitationEmail(data.email, data.email.split("@")[0], workspace?.name ?? "your workspace", `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/invite/${encodeURIComponent(token)}`, 7);
    } catch {
      await prisma.invitation.deleteMany({ where: { id: invitation.id, acceptedAt: null } });
      return res.status(503).json({ error: "Invitation email delivery failed. Please try again later." });
    }
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Invitation", entityId: invitation.id, action: "CREATED", metadata: { email: data.email, role: data.role } });
    res.status(201).json({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt });
  } catch (error) { next(error); }
});

remainingRouter.get("/workspace/invitations", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [invitations, total] = await Promise.all([
      prisma.invitation.findMany({ where, select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.invitation.count({ where }),
    ]);
    res.json(paginate(invitations, total, page, limit));
  } catch (error) { next(error); }
});
remainingRouter.delete("/workspace/invitations/:id", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const invitation = await prisma.invitation.findFirst({ where: { id: String(req.params.id), workspaceId: req.workspaceId } });
    if (!invitation) return res.status(404).json({ error: "Invitation not found." });
    if (invitation.acceptedAt) return res.status(409).json({ error: "Accepted invitations cannot be cancelled." });
    await prisma.invitation.delete({ where: { id: invitation.id } });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Invitation", entityId: invitation.id, action: "CANCELLED" });
    res.status(204).send();
  } catch (error) { next(error); }
});


remainingRouter.get("/reports/summary", async (req, res, next) => {
  try {
    const workspaceId = req.workspaceId!;
    const [invoices, paid, blocked, requests, orders, openRisks] = await Promise.all([
      prisma.invoice.aggregate({ where: { workspaceId }, _sum: { amount: true }, _count: true }),
      prisma.invoice.aggregate({ where: { workspaceId, status: "PAID" }, _sum: { amount: true }, _count: true }),
      prisma.invoice.aggregate({ where: { workspaceId, status: "BLOCKED" }, _sum: { amount: true }, _count: true }),
      prisma.purchaseRequest.aggregate({ where: { workspaceId }, _sum: { amount: true }, _count: true }),
      prisma.purchaseOrder.aggregate({ where: { workspaceId }, _sum: { amount: true }, _count: true }),
      prisma.riskCase.count({ where: { workspaceId, status: "OPEN" } })
    ]);
    res.json({ invoices, paid, blocked, requests, orders, openRisks, generatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

remainingRouter.get("/payments", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { invoice: { include: { vendor: { select: { id: true, name: true, email: true, verified: true } } } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);
    res.json(paginate(payments, total, page, limit));
  } catch (error) { next(error); }
});

remainingRouter.get("/notifications", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId, userId: req.userId };
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.notification.count({ where }),
    ]);
    res.json(paginate(notifications, total, page, limit));
  } catch (error) { next(error); }
});
remainingRouter.patch("/notifications/:id/read", async (req, res, next) => {
  try {
    const notification = await prisma.notification.findFirst({ where: { id: String(req.params.id), workspaceId: req.workspaceId, userId: req.userId } });
    if (!notification) return res.status(404).json({ error: "Notification not found." });
    res.json(await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } }));
  } catch (error) { next(error); }
});

remainingRouter.get("/search", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const query = z.string().trim().min(2).max(100).parse(req.query.q);
    const workspaceId = req.workspaceId!;
    const searchFilter = { contains: query, mode: "insensitive" as const };
    const [vendors, invoices, requests, orders] = await Promise.all([
      prisma.vendor.findMany({ where: { workspaceId, name: searchFilter }, select: { id: true, name: true, email: true }, skip, take: limit }),
      prisma.invoice.findMany({ where: { workspaceId, invoiceNumber: searchFilter }, skip, take: limit }),
      prisma.purchaseRequest.findMany({ where: { workspaceId, title: searchFilter }, skip, take: limit }),
      prisma.purchaseOrder.findMany({ where: { workspaceId, poNumber: searchFilter }, skip, take: limit })
    ]);
    res.json({ vendors, invoices, requests, orders, provider: "postgresql", page, limit });
  } catch (error) { next(error); }
});

remainingRouter.post("/policy/simulate", async (req, res, next) => {
  try {
    const data = z.object({ amount: z.number().finite().nonnegative(), approvalLimit: z.number().finite().nonnegative(), vendorVerified: z.boolean(), hasPurchaseOrder: z.boolean(), duplicate: z.boolean() }).parse(req.body);
    const reasons: string[] = [];
    if (data.duplicate) reasons.push("Duplicate invoice detected.");
    if (!data.vendorVerified) reasons.push("Vendor is not verified.");
    if (!data.hasPurchaseOrder) reasons.push("Purchase order is missing.");
    if (data.amount > data.approvalLimit) reasons.push("Amount exceeds approval limit.");
    res.json({ decision: data.duplicate ? "BLOCK" : reasons.length ? "REVIEW" : "APPROVE", reasons });
  } catch (error) { next(error); }
});

remainingRouter.get("/integrations/:provider/execute", (_req, res) => {
  res.status(501).json({ error: "Provider execution is disabled until credentials are configured. Use /api/integrations/status to inspect setup." });
});
