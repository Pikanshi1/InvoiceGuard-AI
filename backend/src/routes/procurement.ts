import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { requireRole } from "../middleware/workspace";
import { parsePagination, paginate } from "../lib/pagination";

export const procurementRouter = Router();
const roles = ["OWNER", "ADMIN", "MANAGER", "FINANCE"] as const;
const amount = z.number().finite().positive();
const status = z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
const allowedTransitions: Record<string, string[]> = {
  DRAFT: ["PENDING", "CANCELLED"],
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["CANCELLED"],
  REJECTED: [],
  CANCELLED: []
};

procurementRouter.get("/requests", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [requests, total] = await Promise.all([
      prisma.purchaseRequest.findMany({ where, include: { quotations: true, orders: true }, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.purchaseRequest.count({ where }),
    ]);
    res.json(paginate(requests, total, page, limit));
  } catch (error) { next(error); }
});
procurementRouter.post("/requests", requireRole(...roles), async (req, res, next) => {
  try {
    const data = z.object({ title: z.string().min(2), description: z.string().min(1), department: z.string().min(1), amount, currency: z.string().length(3).default("INR") }).parse(req.body);
    const now = new Date();
    const period = now.toISOString().slice(0, 7);
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    let request;
    try {
      request = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`budget:${req.workspaceId}:${data.department}:${period}`})::bigint)`;
        const budget = await tx.budget.findUnique({ where: { workspaceId_department_period: { workspaceId: req.workspaceId!, department: data.department, period } } });
        if (budget) {
          if (budget.currency.toUpperCase() !== data.currency.toUpperCase()) throw Object.assign(new Error("Purchase request currency must match the department budget currency."), { code: "BUDGET_CURRENCY_MISMATCH" });
          const currentSpend = await tx.purchaseRequest.aggregate({
            where: {
              workspaceId: req.workspaceId!,
              department: data.department,
              status: { notIn: ["REJECTED", "CANCELLED"] },
              createdAt: { gte: periodStart, lt: periodEnd }
            },
            _sum: { amount: true }
          });
          if (Number(currentSpend._sum.amount ?? 0) + data.amount > Number(budget.amount)) {
            throw Object.assign(new Error("Purchase request exceeds the available department budget."), { code: "BUDGET_EXCEEDED" });
          }
        }
        return tx.purchaseRequest.create({ data: { ...data, currency: data.currency.toUpperCase(), workspaceId: req.workspaceId!, requesterId: req.userId! } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = String((error as { code?: string }).code);
        if (code === "BUDGET_CURRENCY_MISMATCH") return res.status(409).json({ error: "Purchase request currency must match the department budget currency." });
        if (code === "BUDGET_EXCEEDED") return res.status(409).json({ error: "Purchase request exceeds the available department budget." });
        if (code === "P2034") return res.status(409).json({ error: "Department budget changed. Refresh and try again." });
      }
      throw error;
    }
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "PurchaseRequest", entityId: request.id, action: "CREATED" });
    res.status(201).json(request);
  } catch (error) { next(error); }
});
procurementRouter.patch("/requests/:id", requireRole(...roles), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const data = z.object({ status }).parse(req.body);
    const existing = await prisma.purchaseRequest.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) return res.status(404).json({ error: "Purchase request not found." });
    if (existing.status === data.status) return res.json(existing);
    if (!allowedTransitions[existing.status]?.includes(data.status)) return res.status(409).json({ error: `Cannot change request status from ${existing.status} to ${data.status}.` });
    const changed = await prisma.purchaseRequest.updateMany({ where: { id, workspaceId: req.workspaceId, status: existing.status }, data });
    if (changed.count !== 1) return res.status(409).json({ error: "Purchase request status changed. Refresh and try again." });
    const request = await prisma.purchaseRequest.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!request) return res.status(404).json({ error: "Purchase request not found." });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "PurchaseRequest", entityId: id, action: `STATUS_${data.status}` });
    res.json(request);
  } catch (error) { next(error); }
});

procurementRouter.get("/quotations", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [quotations, total] = await Promise.all([
      prisma.quotation.findMany({ where, include: { vendor: { select: { id: true, name: true, email: true } }, purchaseRequest: true }, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.quotation.count({ where }),
    ]);
    res.json(paginate(quotations, total, page, limit));
  } catch (error) { next(error); }
});
procurementRouter.post("/quotations", requireRole(...roles), async (req, res, next) => {
  try {
    const data = z.object({ purchaseRequestId: z.string(), vendorId: z.string(), amount, deliveryDays: z.number().int().positive().optional(), notes: z.string().max(2000).optional() }).parse(req.body);
    const [request, vendor] = await Promise.all([
      prisma.purchaseRequest.findFirst({ where: { id: data.purchaseRequestId, workspaceId: req.workspaceId } }),
      prisma.vendor.findFirst({ where: { id: data.vendorId, workspaceId: req.workspaceId } })
    ]);
    if (!request || !vendor) return res.status(404).json({ error: "Purchase request or vendor not found in this workspace." });
    const quotation = await prisma.quotation.create({ data: { ...data, workspaceId: req.workspaceId! } });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Quotation", entityId: quotation.id, action: "CREATED" });
    res.status(201).json(quotation);
  } catch (error) { next(error); }
});

procurementRouter.get("/orders", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, include: { vendor: { select: { id: true, name: true, email: true } }, purchaseRequest: true, invoices: true }, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.purchaseOrder.count({ where }),
    ]);
    res.json(paginate(orders, total, page, limit));
  } catch (error) { next(error); }
});
procurementRouter.post("/orders", requireRole(...roles), async (req, res, next) => {
  try {
    const data = z.object({ vendorId: z.string(), purchaseRequestId: z.string().optional(), quotationId: z.string().optional(), poNumber: z.string().min(1).max(100), amount, currency: z.string().length(3).default("INR") }).parse(req.body);
    const vendor = await prisma.vendor.findFirst({ where: { id: data.vendorId, workspaceId: req.workspaceId } });
    if (!vendor) return res.status(404).json({ error: "Vendor not found in this workspace." });
    if (data.purchaseRequestId && !(await prisma.purchaseRequest.findFirst({ where: { id: data.purchaseRequestId, workspaceId: req.workspaceId } }))) return res.status(404).json({ error: "Purchase request not found in this workspace." });
    if (data.quotationId) {
      const quotation = await prisma.quotation.findFirst({ where: { id: data.quotationId, workspaceId: req.workspaceId, vendorId: data.vendorId, purchaseRequestId: data.purchaseRequestId } });
      if (!quotation) return res.status(404).json({ error: "Quotation not found for this vendor and purchase request." });
      if (Number(data.amount) !== Number(quotation.amount)) return res.status(400).json({ error: "Purchase order amount must match the selected quotation amount." });
    }
    const order = await prisma.purchaseOrder.create({ data: { ...data, currency: data.currency.toUpperCase(), workspaceId: req.workspaceId! } });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "PurchaseOrder", entityId: order.id, action: "CREATED" });
    res.status(201).json(order);
  } catch (error) { next(error); }
});

procurementRouter.get("/receipts", async (req, res, next) => {
  try { res.json(await prisma.goodsReceipt.findMany({ where: { workspaceId: req.workspaceId }, include: { purchaseOrder: true }, orderBy: { createdAt: "desc" }, take: 100 })); } catch (error) { next(error); }
});
procurementRouter.post("/receipts", requireRole(...roles), async (req, res, next) => {
  try {
    const data = z.object({ purchaseOrderId: z.string(), reference: z.string().min(1), orderedQty: z.number().int().nonnegative(), receivedQty: z.number().int().nonnegative(), acceptedQty: z.number().int().nonnegative(), notes: z.string().max(2000).optional() }).parse(req.body);
    if (data.orderedQty <= 0 || data.receivedQty > data.orderedQty || data.acceptedQty > data.receivedQty) return res.status(400).json({ error: "Receipt quantities must be ordered >= received >= accepted, with a positive ordered quantity." });
    const order = await prisma.purchaseOrder.findFirst({ where: { id: data.purchaseOrderId, workspaceId: req.workspaceId } });
    if (!order) return res.status(404).json({ error: "Purchase order not found in this workspace." });
    let receipt;
    try {
      receipt = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"receipt:" + order.id})::bigint)`;
        const existingReceipts = await tx.goodsReceipt.findMany({ where: { workspaceId: req.workspaceId, purchaseOrderId: order.id }, select: { orderedQty: true, receivedQty: true, acceptedQty: true } });
        const expectedOrderedQty = existingReceipts[0]?.orderedQty ?? data.orderedQty;
        if (existingReceipts.some(item => item.orderedQty !== expectedOrderedQty)) {
          throw Object.assign(new Error("Existing receipt quantities for this purchase order need reconciliation."), { code: "RECEIPT_ORDERED_QTY_INCONSISTENT" });
        }
        if (data.orderedQty !== expectedOrderedQty) {
          throw Object.assign(new Error("Ordered quantity must match the other receipts for this purchase order."), { code: "RECEIPT_ORDERED_QTY_MISMATCH" });
        }
        const cumulativeReceived = existingReceipts.reduce((total, item) => total + item.receivedQty, 0) + data.receivedQty;
        const cumulativeAccepted = existingReceipts.reduce((total, item) => total + item.acceptedQty, 0) + data.acceptedQty;
        if (cumulativeReceived > expectedOrderedQty || cumulativeAccepted > cumulativeReceived) {
          throw Object.assign(new Error("Cumulative receipt quantities cannot exceed the purchase order or accepted quantity cannot exceed received quantity."), { code: "RECEIPT_CUMULATIVE_QTY_INVALID" });
        }
        return tx.goodsReceipt.create({ data: { ...data, workspaceId: req.workspaceId! } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = String((error as { code?: string }).code);
        if (code === "RECEIPT_ORDERED_QTY_INCONSISTENT") return res.status(409).json({ error: "Existing receipt quantities for this purchase order need reconciliation." });
        if (code === "RECEIPT_ORDERED_QTY_MISMATCH") return res.status(400).json({ error: "Ordered quantity must match the other receipts for this purchase order." });
        if (code === "RECEIPT_CUMULATIVE_QTY_INVALID") return res.status(400).json({ error: "Cumulative receipt quantities cannot exceed the purchase order or accepted quantity cannot exceed received quantity." });
        if (code === "P2034") return res.status(409).json({ error: "Receipt state changed. Refresh and try again." });
      }
      throw error;
    }
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "GoodsReceipt", entityId: receipt.id, action: "CREATED" });
    res.status(201).json(receipt);
  } catch (error) { next(error); }
});

procurementRouter.get("/budgets", async (req, res, next) => {
  try { res.json(await prisma.budget.findMany({ where: { workspaceId: req.workspaceId }, orderBy: [{ period: "desc" }, { department: "asc" }], take: 100 })); } catch (error) { next(error); }
});
procurementRouter.post("/budgets", requireRole("OWNER", "ADMIN", "FINANCE"), async (req, res, next) => {
  try {
    const data = z.object({ department: z.string().min(1), period: z.string().min(1), amount, currency: z.string().length(3).default("INR") }).parse(req.body);
    const budget = await prisma.budget.create({ data: { ...data, currency: data.currency.toUpperCase(), workspaceId: req.workspaceId! } });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Budget", entityId: budget.id, action: "CREATED" });
    res.status(201).json(budget);
  } catch (error) { next(error); }
});
