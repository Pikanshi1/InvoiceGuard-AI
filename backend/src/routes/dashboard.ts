import { Router } from "express";
import { prisma } from "../lib/prisma";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", async (req, res, next) => {
  try {
    const workspaceId = req.workspaceId!;
    const [invoices, requests, approvals, riskCases, vendors] = await Promise.all([
      prisma.invoice.count({ where: { workspaceId } }),
      prisma.purchaseRequest.count({ where: { workspaceId } }),
      prisma.approval.count({ where: { workspaceId, status: "PENDING" } }),
      prisma.riskCase.count({ where: { workspaceId, status: "OPEN" } }),
      prisma.vendor.count({ where: { workspaceId } })
    ]);
    res.json({ invoices, requests, approvals, riskCases, vendors });
  } catch (error) { next(error); }
});
