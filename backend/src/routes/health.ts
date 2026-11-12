import { Router } from "express";
import { prisma } from "../lib/prisma";
import { logServerError } from "../lib/logging";

export const healthRouter = Router();
healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: "ok", service: "invoiceguard-api", timestamp: new Date().toISOString() });
  } catch (error) {
    logServerError("api_health_check_failed", error);
    return res.status(503).json({ status: "unavailable", service: "invoiceguard-api" });
  }
});
