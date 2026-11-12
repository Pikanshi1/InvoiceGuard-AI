import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { requireRole } from "../middleware/workspace";
import { Prisma } from "@prisma/client";
import { getInvoiceApprovalBlockReason } from "../lib/invoice-approval";
import { parsePagination, paginate } from "../lib/pagination";

export const governanceRouter = Router();
governanceRouter.get("/approvals", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [approvals, total] = await Promise.all([
      prisma.approval.findMany({
        where,
        include: { invoice: { include: { vendor: { select: { id: true, name: true, email: true, verified: true } } } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.approval.count({ where }),
    ]);
    res.json(paginate(approvals, total, page, limit));
  } catch (error) { next(error); }
});
governanceRouter.post("/approvals", requireRole("OWNER", "ADMIN", "MANAGER", "FINANCE"), async (req, res, next) => {
  try {
    const data = z.object({ invoiceId: z.string() }).parse(req.body);
    const invoice = await prisma.invoice.findFirst({ where: { id: data.invoiceId, workspaceId: req.workspaceId } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found in this workspace." });
    if (!invoice.evaluatedAt) return res.status(409).json({ error: "Evaluate this invoice before requesting approval.", code: "POLICY_EVALUATION_REQUIRED" });
    if (!["PENDING", "REVIEW"].includes(invoice.status)) return res.status(409).json({ error: "Only evaluated pending or review invoices can be submitted for approval." });
    let approval;
    try {
      approval = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"approval:" + invoice.id})::bigint)`;
        const currentInvoice = await tx.invoice.findFirst({ where: { id: invoice.id, workspaceId: req.workspaceId } });
        if (!currentInvoice || !currentInvoice.evaluatedAt || !["PENDING", "REVIEW"].includes(currentInvoice.status)) {
          throw Object.assign(new Error("Invoice state changed before approval could be requested."), { code: "APPROVAL_REQUEST_CONFLICT" });
        }
        const existing = await tx.approval.findFirst({ where: { workspaceId: req.workspaceId, invoiceId: invoice.id, status: "PENDING" }, select: { id: true } });
        if (existing) throw Object.assign(new Error("This invoice already has a pending approval request."), { code: "APPROVAL_REQUEST_EXISTS" });
        return tx.approval.create({ data: { workspaceId: req.workspaceId!, invoiceId: data.invoiceId } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = String((error as { code?: string }).code);
        if (code === "APPROVAL_REQUEST_EXISTS") return res.status(409).json({ error: "This invoice already has a pending approval request." });
        if (code === "APPROVAL_REQUEST_CONFLICT" || code === "P2034") return res.status(409).json({ error: "Invoice state changed. Refresh and try again." });
      }
      throw error;
    }
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Approval", entityId: approval.id, action: "CREATED" });
    res.status(201).json(approval);
  } catch (error) { next(error); }
});
governanceRouter.patch("/approvals/:id", requireRole("OWNER", "ADMIN", "MANAGER", "FINANCE"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const data = z.object({ status: z.enum(["APPROVED", "REJECTED", "NEEDS_INFO"]), note: z.string().max(2000).optional() }).parse(req.body);
    const approval = await prisma.approval.findFirst({ where: { id, workspaceId: req.workspaceId }, include: { invoice: true } });
    if (!approval) return res.status(404).json({ error: "Approval not found." });
    if (approval.status !== "PENDING") return res.status(409).json({ error: "This approval has already been decided." });
    if (!approval.invoice) return res.status(409).json({ error: "This approval is not linked to an invoice." });
    if (data.status === "APPROVED") {
      const reason = getInvoiceApprovalBlockReason(approval.invoice, req.userId!);
      if (reason) {
        const messages = {
          NOT_EVALUATED: "Evaluate this invoice before approval.",
          CREATOR_UNKNOWN: "The invoice creator cannot be established, so approval is blocked.",
          SELF_APPROVAL: "You cannot approve an invoice you created.",
          INVALID_STATUS: "Only evaluated pending or review invoices can be approved."
        };
        return res.status(409).json({ error: messages[reason], code: reason });
      }
    }
    let updated;
    try {
      updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const freshApproval = await tx.approval.findFirst({
          where: { id, workspaceId: req.workspaceId, status: "PENDING" },
          include: { invoice: true }
        });
        if (!freshApproval || !freshApproval.invoice) throw Object.assign(new Error("Approval is no longer pending."), { code: "APPROVAL_CONFLICT" });

        if (data.status === "APPROVED" || data.status === "REJECTED") {
          if (!freshApproval.invoice.evaluatedAt || !["PENDING", "REVIEW"].includes(freshApproval.invoice.status)) {
            throw Object.assign(new Error("Invoice is no longer awaiting a decision."), { code: "APPROVAL_CONFLICT" });
          }
          if (data.status === "APPROVED") {
            const reason = getInvoiceApprovalBlockReason(freshApproval.invoice, req.userId!);
            if (reason) throw Object.assign(new Error(reason), { code: "APPROVAL_CONFLICT" });
          }
        }

        const claimed = await tx.approval.updateMany({
          where: { id, workspaceId: req.workspaceId, status: "PENDING" },
          data: { ...data, approverId: req.userId!, decidedAt: new Date() }
        });
        if (claimed.count !== 1) throw Object.assign(new Error("Approval is no longer pending."), { code: "APPROVAL_CONFLICT" });

        if (data.status === "APPROVED" || data.status === "REJECTED") {
          const invoiceUpdate = await tx.invoice.updateMany({
            where: {
              id: freshApproval.invoiceId!,
              workspaceId: req.workspaceId,
              status: freshApproval.invoice.status,
              evaluatedAt: { not: null },
              ...(data.status === "APPROVED" ? { createdById: { not: req.userId! } } : {})
            },
            data: { status: data.status }
          });
          if (invoiceUpdate.count !== 1) throw Object.assign(new Error("Invoice state changed during approval."), { code: "APPROVAL_CONFLICT" });
        }
        return tx.approval.findUniqueOrThrow({ where: { id } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["APPROVAL_CONFLICT", "P2034"].includes(String((error as { code?: string }).code))) {
        return res.status(409).json({ error: "Approval or invoice state changed. Refresh and try again." });
      }
      throw error;
    }
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Approval", entityId: id, action: data.status, metadata: data.note ? { note: data.note } : undefined });
    res.json(updated);
  } catch (error) { next(error); }
});
governanceRouter.get("/risk-cases", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [riskCases, total] = await Promise.all([
      prisma.riskCase.findMany({ where, include: { invoice: true }, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.riskCase.count({ where }),
    ]);
    res.json(paginate(riskCases, total, page, limit));
  } catch (error) { next(error); }
});
governanceRouter.post("/risk-cases", requireRole("OWNER", "ADMIN", "MANAGER", "FINANCE"), async (req, res, next) => {
  try {
    const data = z.object({ title: z.string().min(2), description: z.string().min(1), severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), invoiceId: z.string().optional() }).parse(req.body);
    if (data.invoiceId && !(await prisma.invoice.findFirst({ where: { id: data.invoiceId, workspaceId: req.workspaceId } }))) return res.status(404).json({ error: "Invoice not found in this workspace." });
    const riskCase = await prisma.riskCase.create({ data: { ...data, workspaceId: req.workspaceId! } });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "RiskCase", entityId: riskCase.id, action: "CREATED" });
    res.status(201).json(riskCase);
  } catch (error) { next(error); }
});
governanceRouter.get("/audit-events", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [auditEvents, total] = await Promise.all([
      prisma.auditEvent.findMany({ where, include: { actor: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.auditEvent.count({ where }),
    ]);
    res.json(paginate(auditEvents, total, page, limit));
  } catch (error) { next(error); }
});
