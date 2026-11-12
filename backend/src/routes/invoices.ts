import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRole } from "../middleware/workspace";
import { recordAuditEvent } from "../lib/audit";
import { indexWorkspaceRecord } from "../lib/search-index";
import { evaluateInvoice } from "../lib/policy";
import { resolvePolicyThresholds } from "../lib/policy-config";
import { isPaymentDestinationPendingVerification } from "../lib/vendor-verification";
import { parsePagination, paginate } from "../lib/pagination";

export const invoiceRouter = Router();

invoiceRouter.get("/", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { vendor: { select: { id: true, name: true, email: true, verified: true } }, purchaseOrder: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);
    res.json(paginate(invoices, total, page, limit));
  } catch (e) { next(e); }
});

invoiceRouter.get("/export.csv", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER", "AUDITOR"), async (req, res, next) => {
  try {
    const filters = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      vendorId: z.string().min(1).max(100).optional(),
      status: z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED", "BLOCKED", "PAID", "CANCELLED", "REVIEW"]).optional(),
      minAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      maxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
    }).parse(req.query);
    const validDate = (value?: string) => !value || (!Number.isNaN(Date.parse(value + "T00:00:00.000Z")) && new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) === value);
    if (!validDate(filters.from) || !validDate(filters.to)) return res.status(400).json({ error: "Export dates must be valid calendar dates." });
    const from = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : undefined;
    const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : undefined;
    if (from && to && from > to) return res.status(400).json({ error: "The start date must be on or before the end date." });
    if (filters.minAmount && filters.maxAmount && Number(filters.minAmount) > Number(filters.maxAmount)) return res.status(400).json({ error: "The minimum amount cannot exceed the maximum amount." });
    const rows = await prisma.invoice.findMany({
      where: {
        workspaceId: req.workspaceId,
        ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(filters.minAmount || filters.maxAmount ? { amount: { ...(filters.minAmount ? { gte: Number(filters.minAmount) } : {}), ...(filters.maxAmount ? { lte: Number(filters.maxAmount) } : {}) } } : {})
      },
      include: { vendor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 10000
    });
    const safeCell = (value: unknown) => {
      const text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
      const guarded = /^[\s]*[=+@\-]/.test(text) ? "'" + text : text;
      return '"' + guarded.replace(/"/g, '""') + '"';
    };
    const header = ["Invoice Number", "Vendor", "Issue Date", "Due Date", "Created At", "Status", "Currency", "Amount", "Tax Amount", "Risk Level", "Risk Score"];
    const lines = [header, ...rows.map(invoice => [
      invoice.invoiceNumber, invoice.vendor.name, invoice.issueDate, invoice.dueDate, invoice.createdAt,
      invoice.status, invoice.currency, invoice.amount, invoice.taxAmount, invoice.riskLevel, invoice.riskScore
    ])].map(row => row.map(safeCell).join(","));
    await recordAuditEvent({
      workspaceId: req.workspaceId!,
      actorId: req.userId,
      entityType: "InvoiceExport",
      entityId: req.workspaceId!,
      action: "EXPORTED",
      metadata: { count: rows.length, filters }
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="invoiceguard-invoices.csv"');
    res.setHeader("Cache-Control", "no-store");
    res.send("\uFEFF" + lines.join("\r\n"));
  } catch (error) { next(error); }
});

const createSchema = z.object({
  vendorId: z.string().min(1),
  purchaseOrderId: z.string().optional(),
  invoiceNumber: z.string().min(1).max(100),
  amount: z.number().finite().positive(),
  taxAmount: z.number().finite().min(0).default(0),
  currency: z.string().length(3).default("INR"),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional()
});

invoiceRouter.post("/", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const vendor = await prisma.vendor.findFirst({ where: { id: data.vendorId, workspaceId: req.workspaceId } });
    if (!vendor) return res.status(404).json({ error: "Vendor not found in this workspace." });
    if (data.purchaseOrderId) {
      const po = await prisma.purchaseOrder.findFirst({ where: { id: data.purchaseOrderId, workspaceId: req.workspaceId } });
      if (!po) return res.status(404).json({ error: "Purchase order not found in this workspace." });
      if (po.vendorId !== vendor.id) return res.status(409).json({ error: "Invoice vendor must match the purchase order vendor." });
      if (po.currency.toUpperCase() !== data.currency.toUpperCase()) return res.status(409).json({ error: "Invoice currency must match the purchase order currency." });
    }
    const invoice = await prisma.invoice.create({
      data: {
        workspaceId: req.workspaceId!,
        createdById: req.userId!,
        vendorId: data.vendorId,
        purchaseOrderId: data.purchaseOrderId,
        invoiceNumber: data.invoiceNumber,
        amount: data.amount,
        taxAmount: data.taxAmount,
        currency: data.currency.toUpperCase(),
        issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined
      }
    });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Invoice", entityId: invoice.id, action: "CREATED" });
    await indexWorkspaceRecord({ workspaceId: req.workspaceId!, entityType: "Invoice", entityId: invoice.id, document: { invoiceNumber: invoice.invoiceNumber, amount: invoice.amount.toString() } });
    res.status(201).json(invoice);
  } catch (e) { next(e); }
});

invoiceRouter.get("/:id/match", async (req, res, next) => {
  try {
    const invoiceId = String(req.params.id);
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: req.workspaceId },
      include: { purchaseOrder: { include: { receipts: { select: { orderedQty: true, receivedQty: true, acceptedQty: true } } } } }
    });
    if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    const purchaseOrder = invoice.purchaseOrder;
    const receivedQty = purchaseOrder ? purchaseOrder.receipts.reduce((total, receipt) => total + receipt.acceptedQty, 0) : 0;
    const orderedQty = purchaseOrder ? Math.max(0, ...purchaseOrder.receipts.map(receipt => receipt.orderedQty)) : 0;
    const hasPurchaseOrder = Boolean(purchaseOrder);
    const amountMatches = purchaseOrder ? Number(invoice.amount) <= Number(purchaseOrder.amount) : false;
    const receiptMatches = purchaseOrder
      ? purchaseOrder.receipts.length > 0 &&
        orderedQty > 0 &&
        purchaseOrder.receipts.every(receipt => receipt.orderedQty === orderedQty && receipt.acceptedQty <= receipt.receivedQty) &&
        receivedQty === orderedQty
      : false;
    const decision = hasPurchaseOrder && amountMatches && receiptMatches ? "MATCHED" : "REVIEW";
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Invoice", entityId: invoiceId, action: "THREE_WAY_MATCHED", metadata: { decision, receivedQty, orderedQty, hasPurchaseOrder, amountMatches, receiptMatches } });
    res.json({
      invoiceId,
      purchaseOrderId: purchaseOrder?.id ?? null,
      checks: { purchaseOrder: hasPurchaseOrder, amount: amountMatches, receipt: receiptMatches },
      decision,
      receivedQty,
      orderedQty
    });
  } catch (error) { next(error); }
});

invoiceRouter.post("/:id/evaluate", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER", "AUDITOR"), async (req, res, next) => {
  try {
    const invoiceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: req.workspaceId },
      include: { vendor: true, purchaseOrder: { include: { receipts: { select: { orderedQty: true, acceptedQty: true } } } } }
    });

    if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    if (!["PENDING", "REVIEW", "BLOCKED"].includes(invoice.status)) {
      return res.status(409).json({ error: "This invoice is no longer eligible for policy evaluation." });
    }

    const duplicate = await prisma.invoice.count({
      where: { workspaceId: req.workspaceId, vendorId: invoice.vendorId, invoiceNumber: invoice.invoiceNumber, NOT: { id: invoice.id } }
    }) > 0;
    const enabledPolicies = await prisma.securityPolicy.findMany({ where: { workspaceId: req.workspaceId, enabled: true }, select: { config: true } });
    const thresholds = resolvePolicyThresholds(enabledPolicies.map(policy => policy.config));

    const result = evaluateInvoice({
      invoiceAmount: Number(invoice.amount),
      poAmount: invoice.purchaseOrder ? Number(invoice.purchaseOrder.amount) : null,
      vendorVerified: invoice.vendor.verified,
      duplicate,
      paymentDestinationChanged: isPaymentDestinationPendingVerification(invoice.vendor.verificationNote),
      receivedQuantity: invoice.purchaseOrder ? invoice.purchaseOrder.receipts.reduce((total, receipt) => total + receipt.acceptedQty, 0) : undefined,
      orderedQuantity: invoice.purchaseOrder ? Math.max(0, ...invoice.purchaseOrder.receipts.map(receipt => receipt.orderedQty)) : undefined,
      receiptEvidenceMissing: Boolean(invoice.purchaseOrder && invoice.purchaseOrder.receipts.length === 0),
      approvalLimit: thresholds.approvalLimit,
      poTolerancePercent: thresholds.poTolerancePercent
    });

    const updatedCount = await prisma.invoice.updateMany({
      where: { id: invoice.id, workspaceId: req.workspaceId, status: invoice.status },
      data: {
        riskScore: result.score,
        riskLevel: result.score >= 80 ? "CRITICAL" : result.score >= 50 ? "HIGH" : result.score > 0 ? "MEDIUM" : "LOW",
        status: result.decision === "BLOCK" ? "BLOCKED" : result.decision === "REVIEW" ? "REVIEW" : "PENDING",
        evaluatedAt: new Date()
      }
    });
    if (updatedCount.count !== 1) return res.status(409).json({ error: "Invoice status changed while policy evaluation was running. Evaluate it again." });
    const updated = await prisma.invoice.findFirst({ where: { id: invoice.id, workspaceId: req.workspaceId } });
    if (!updated) return res.status(404).json({ error: "Invoice not found." });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Invoice", entityId: invoice.id, action: "EVALUATED", metadata: { decision: result.decision, score: result.score } });
    res.json({ invoice: updated, ...result });
  } catch (e) { next(e); }
});
