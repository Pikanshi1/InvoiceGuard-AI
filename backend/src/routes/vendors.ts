import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRole } from "../middleware/workspace";
import { indexWorkspaceRecord } from "../lib/search-index";
import { recordAuditEventInTransaction } from "../lib/audit";
import { getPreservedVerificationNote, isPaymentDestinationPendingVerification, markPaymentDestinationPending } from "../lib/vendor-verification";
import { parsePagination, paginate } from "../lib/pagination";

export const vendorRouter = Router();
vendorRouter.get("/", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const canReadPaymentDetails = ["OWNER", "ADMIN", "FINANCE"].includes(req.role ?? "");
    const where = { workspaceId: req.workspaceId };
    const select = {
      id: true, name: true, email: true, verified: true,
      ...(canReadPaymentDetails ? { taxId: true, bankAccountLast4: true, verificationNote: true } : {})
    };
    const [vendors, total] = await Promise.all([
      prisma.vendor.findMany({ where, orderBy: { name: "asc" }, skip, take: limit, select }),
      prisma.vendor.count({ where }),
    ]);
    res.json(paginate(vendors, total, page, limit));
  } catch (e) { next(e); }
});
vendorRouter.post("/", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER"), async (req, res, next) => {
  try {
    const data = z.object({ name: z.string().min(2), email: z.string().email().optional(), taxId: z.string().optional() }).parse(req.body);
    const normalizedName = data.name.trim().toLowerCase().replace(/\s+/g, " ");
    const vendor = await prisma.$transaction(async tx => {
      const created = await tx.vendor.create({ data: { ...data, name: data.name.trim(), normalizedName, workspaceId: req.workspaceId! } });
      await recordAuditEventInTransaction(tx, { workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Vendor", entityId: created.id, action: "CREATED" });
      return created;
    });
    await indexWorkspaceRecord({ workspaceId: req.workspaceId!, entityType: "Vendor", entityId: vendor.id, document: { name: vendor.name, email: vendor.email ?? "" } });
    res.status(201).json(vendor);
  } catch (e) { next(e); }
});

vendorRouter.patch("/:id/payment-destination", requireRole("OWNER", "ADMIN", "FINANCE"), async (req, res, next) => {
  try {
    const data = z.object({ bankAccountLast4: z.string().regex(/^\d{4}$/) }).parse(req.body);
    const vendor = await prisma.$transaction(async tx => {
      const current = await tx.vendor.findFirst({ where: { id: String(req.params.id), workspaceId: req.workspaceId } });
      if (!current) throw Object.assign(new Error("Vendor not found."), { code: "VENDOR_NOT_FOUND" });
      if (current.bankAccountLast4 === data.bankAccountLast4 && isPaymentDestinationPendingVerification(current.verificationNote)) return current;
      const changed = await tx.vendor.updateMany({
        where: { id: current.id, workspaceId: req.workspaceId, updatedAt: current.updatedAt },
        data: { bankAccountLast4: data.bankAccountLast4, verified: false, verificationNote: markPaymentDestinationPending(current.verificationNote) }
      });
      if (changed.count !== 1) throw Object.assign(new Error("Vendor changed while the payment destination was being updated."), { code: "VENDOR_CONFLICT" });
      await tx.invoice.updateMany({
        where: { workspaceId: req.workspaceId, vendorId: current.id, status: { in: ["PENDING", "REVIEW", "BLOCKED", "APPROVED"] } },
        data: { status: "REVIEW", evaluatedAt: null }
      });
      const updated = await tx.vendor.findFirst({ where: { id: current.id, workspaceId: req.workspaceId } });
      if (!updated) throw Object.assign(new Error("Vendor not found."), { code: "VENDOR_NOT_FOUND" });
      await recordAuditEventInTransaction(tx, {
        workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Vendor", entityId: current.id,
        action: "PAYMENT_DESTINATION_CHANGED", metadata: { destinationChanged: true }
      });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.json(vendor);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: string }).code);
      if (code === "VENDOR_NOT_FOUND") return res.status(404).json({ error: "Vendor not found in this workspace." });
      if (code === "VENDOR_CONFLICT" || code === "P2034") return res.status(409).json({ error: "Vendor changed. Refresh and try again." });
    }
    next(error);
  }
});

vendorRouter.patch("/:id/verification", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const data = z.object({ verificationNote: z.string().trim().min(5).max(500) }).parse(req.body);
    const vendor = await prisma.$transaction(async tx => {
      const current = await tx.vendor.findFirst({ where: { id: String(req.params.id), workspaceId: req.workspaceId } });
      if (!current) throw Object.assign(new Error("Vendor not found."), { code: "VENDOR_NOT_FOUND" });
      if (current.verified && !isPaymentDestinationPendingVerification(current.verificationNote)) return current;

      const latestAudit = await tx.auditEvent.findFirst({
        where: { workspaceId: req.workspaceId, entityType: "Vendor", entityId: current.id, action: { in: ["CREATED", "PAYMENT_DESTINATION_CHANGED"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      if (isPaymentDestinationPendingVerification(current.verificationNote) &&
          (!latestAudit || latestAudit.action !== "PAYMENT_DESTINATION_CHANGED" || latestAudit.createdAt < current.updatedAt)) {
        throw Object.assign(new Error("The payment destination change could not be independently verified."), { code: "VERIFICATION_EVIDENCE_MISSING" });
      }
      if (latestAudit?.actorId && latestAudit.actorId === req.userId) {
        throw Object.assign(new Error("The person who last changed this vendor record cannot verify it."), { code: "SELF_VERIFICATION" });
      }

      const changed = await tx.vendor.updateMany({
        where: { id: current.id, workspaceId: req.workspaceId, updatedAt: current.updatedAt },
        data: {
          verified: true,
          verificationNote: [getPreservedVerificationNote(current.verificationNote), `Verified: ${data.verificationNote}`].filter(Boolean).join("\n\n")
        }
      });
      if (changed.count !== 1) throw Object.assign(new Error("Vendor changed while verification was being recorded."), { code: "VENDOR_CONFLICT" });
      const updated = await tx.vendor.findFirst({ where: { id: current.id, workspaceId: req.workspaceId } });
      if (!updated) throw Object.assign(new Error("Vendor not found."), { code: "VENDOR_NOT_FOUND" });
      await recordAuditEventInTransaction(tx, {
        workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Vendor", entityId: current.id,
        action: isPaymentDestinationPendingVerification(current.verificationNote) ? "PAYMENT_DESTINATION_VERIFIED" : "VENDOR_VERIFIED"
      });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.json(vendor);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: string }).code);
      if (code === "VENDOR_NOT_FOUND") return res.status(404).json({ error: "Vendor not found in this workspace." });
      if (code === "SELF_VERIFICATION") return res.status(403).json({ error: "The person who last changed this vendor record cannot verify it." });
      if (code === "VERIFICATION_EVIDENCE_MISSING") return res.status(409).json({ error: "The payment destination change could not be independently verified." });
      if (code === "VENDOR_CONFLICT" || code === "P2034") return res.status(409).json({ error: "Vendor changed. Refresh and try again." });
    }
    next(error);
  }
});
