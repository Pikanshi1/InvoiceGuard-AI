import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { requireRole } from "../middleware/workspace";
import { parsePagination, paginate } from "../lib/pagination";

export const agreementRouter = Router();

agreementRouter.get("/", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [agreements, total] = await Promise.all([
      prisma.agreement.findMany({
        where,
        include: { vendor: { select: { id: true, name: true, email: true } } },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
      prisma.agreement.count({ where }),
    ]);
    res.json(paginate(agreements, total, page, limit));
  } catch (error) { next(error); }
});

agreementRouter.post("/", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER"), async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().trim().min(2).max(200),
      description: z.string().max(4000).optional(),
      vendorId: z.string().optional(),
      status: z.enum(["DRAFT", "PENDING", "APPROVED", "CANCELLED"]).default("DRAFT"),
      startDate: z.string().datetime().optional(),
      expiresAt: z.string().datetime().optional(),
      documentUrl: z.string().url().max(2048).optional()
    }).parse(req.body);
    if (data.vendorId && !(await prisma.vendor.findFirst({ where: { id: data.vendorId, workspaceId: req.workspaceId } }))) {
      return res.status(404).json({ error: "Vendor not found in this workspace." });
    }
    const agreement = await prisma.agreement.create({
      data: {
        workspaceId: req.workspaceId!,
        vendorId: data.vendorId,
        name: data.name,
        description: data.description,
        status: data.status,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        documentUrl: data.documentUrl
      },
      include: { vendor: { select: { id: true, name: true, email: true } } }
    });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Agreement", entityId: agreement.id, action: "CREATED" });
    res.status(201).json(agreement);
  } catch (error) { next(error); }
});

agreementRouter.patch("/:id", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER"), async (req, res, next) => {
  try {
    const data = z.object({
      status: z.enum(["DRAFT", "PENDING", "APPROVED", "CANCELLED"]).optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      documentUrl: z.string().url().max(2048).nullable().optional()
    }).parse(req.body);
    const agreement = await prisma.agreement.findFirst({ where: { id: String(req.params.id), workspaceId: req.workspaceId } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found." });
    const updated = await prisma.agreement.update({
      where: { id: agreement.id },
      data: { status: data.status, expiresAt: data.expiresAt === undefined ? undefined : data.expiresAt ? new Date(data.expiresAt) : null, documentUrl: data.documentUrl },
      include: { vendor: { select: { id: true, name: true, email: true } } }
    });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Agreement", entityId: agreement.id, action: "UPDATED", metadata: data.status ? { status: data.status } : undefined });
    res.json(updated);
  } catch (error) { next(error); }
});
