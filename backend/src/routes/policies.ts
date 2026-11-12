import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRole } from "../middleware/workspace";
import { recordAuditEvent } from "../lib/audit";
import { parsePagination, paginate } from "../lib/pagination";

export const policyRouter = Router();
const policyConfigSchema = z.object({
  approvalLimit: z.number().finite().positive().optional(),
  poTolerancePercent: z.number().finite().min(0).max(100).optional()
}).passthrough();

policyRouter.get("/", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [policies, total] = await Promise.all([
      prisma.securityPolicy.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take: limit }),
      prisma.securityPolicy.count({ where }),
    ]);
    res.json(paginate(policies, total, page, limit));
  } catch (e) { next(e); }
});
policyRouter.post("/", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const data = z.object({ name: z.string().trim().min(2).max(120), enabled: z.boolean().default(true), config: policyConfigSchema }).parse(req.body);
    const policy = await prisma.securityPolicy.create({
      data: { ...data, config: data.config as Prisma.InputJsonValue, workspaceId: req.workspaceId! }
    });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "SecurityPolicy", entityId: policy.id, action: "CREATED", metadata: { name: policy.name, enabled: policy.enabled, version: policy.version } });
    res.status(201).json(policy);
  } catch (e) { next(e); }
});

policyRouter.patch("/:id", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().trim().min(2).max(120).optional(),
      enabled: z.boolean().optional(),
      config: policyConfigSchema.optional()
    }).refine(value => Object.keys(value).length > 0, "At least one policy field must be supplied.").parse(req.body);
    const current = await prisma.securityPolicy.findFirst({ where: { id: String(req.params.id), workspaceId: req.workspaceId } });
    if (!current) return res.status(404).json({ error: "Security policy not found." });
    const changed = await prisma.securityPolicy.updateMany({
      where: { id: current.id, workspaceId: req.workspaceId, version: current.version },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.config !== undefined ? { config: data.config as Prisma.InputJsonValue } : {}),
        version: { increment: 1 }
      }
    });
    if (changed.count !== 1) return res.status(409).json({ error: "Security policy changed. Refresh and try again." });
    const policy = await prisma.securityPolicy.findFirst({ where: { id: current.id, workspaceId: req.workspaceId } });
    if (!policy) return res.status(404).json({ error: "Security policy not found." });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "SecurityPolicy", entityId: policy.id, action: "UPDATED", metadata: { name: policy.name, enabled: policy.enabled, version: policy.version } });
    res.json(policy);
  } catch (error) { next(error); }
});
