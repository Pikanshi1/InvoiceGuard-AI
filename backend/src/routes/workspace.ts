import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { requireRole } from "../middleware/workspace";
import { parsePagination, paginate } from "../lib/pagination";

export const workspaceRouter = Router();

workspaceRouter.get("/members", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId };
    const [members, total] = await Promise.all([
      prisma.membership.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
        skip,
        take: limit,
      }),
      prisma.membership.count({ where }),
    ]);
    res.json(paginate(members, total, page, limit));
  } catch (error) { next(error); }
});

workspaceRouter.patch("/members/:id", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const data = z.object({ role: z.enum(["OWNER", "ADMIN", "MANAGER", "FINANCE", "EMPLOYEE", "AUDITOR"]) }).parse(req.body);
    let updated;
    try {
      updated = await prisma.$transaction(async tx => {
        const membership = await tx.membership.findFirst({ where: { id, workspaceId: req.workspaceId } });
        if (!membership) throw Object.assign(new Error("Workspace member not found."), { code: "MEMBERSHIP_NOT_FOUND" });
        if (membership.role === "OWNER" && req.role !== "OWNER") {
          throw Object.assign(new Error("Only a workspace owner can change an owner role."), { code: "OWNER_ROLE_RESTRICTED" });
        }
        if (data.role === "OWNER" && req.role !== "OWNER") {
          throw Object.assign(new Error("Only a workspace owner can assign the owner role."), { code: "OWNER_ROLE_RESTRICTED" });
        }
        if (membership.userId === req.userId && membership.role === "OWNER" && data.role !== "OWNER") {
          throw Object.assign(new Error("The active owner cannot remove their own owner role."), { code: "LAST_OWNER" });
        }
        if (membership.role === "OWNER" && data.role !== "OWNER") {
          const owners = await tx.membership.count({ where: { workspaceId: req.workspaceId, role: "OWNER" } });
          if (owners <= 1) throw Object.assign(new Error("A workspace must keep at least one owner."), { code: "LAST_OWNER" });
        }
        const changed = await tx.membership.updateMany({
          where: { id, workspaceId: req.workspaceId, role: membership.role },
          data
        });
        if (changed.count !== 1) throw Object.assign(new Error("Workspace membership changed."), { code: "MEMBERSHIP_CONFLICT" });
        return tx.membership.findUniqueOrThrow({ where: { id } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = String((error as { code?: string }).code);
        if (code === "MEMBERSHIP_NOT_FOUND") return res.status(404).json({ error: "Workspace member not found." });
        if (code === "OWNER_ROLE_RESTRICTED" || code === "LAST_OWNER") return res.status(403).json({ error: error instanceof Error ? error.message : "Workspace owner role change is not allowed." });
        if (code === "MEMBERSHIP_CONFLICT" || code === "P2034") return res.status(409).json({ error: "Workspace membership changed. Refresh and try again." });
      }
      throw error;
    }
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Membership", entityId: id, action: "ROLE_CHANGED", metadata: { role: data.role } });
    res.json(updated);
  } catch (error) { next(error); }
});
