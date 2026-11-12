import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: { securityPolicy: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() } },
  recordAuditEvent: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));

import { policyRouter } from "./policies";

describe("workspace security policy rules", () => {
  let server: Server;
  let baseUrl: string;
  let role: "OWNER" | "EMPLOYEE";

  beforeEach(async () => {
    vi.resetAllMocks();
    role = "OWNER";
    mocks.recordAuditEvent.mockResolvedValue({ id: "audit-1" });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = "owner-1";
      req.role = role;
      next();
    });
    app.use("/api/policies", policyRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error && typeof error === "object" && "issues" in error) return res.status(400).json({ error: "Validation failed" });
      return res.status(500).json({ error: "Unexpected server error." });
    });
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/policies`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("validates configured thresholds while preserving unrelated legacy config keys", async () => {
    const policy = { id: "policy-1", name: "Finance thresholds", enabled: true, version: 1, config: { approvalLimit: 50000, poTolerancePercent: 2, customFlag: "preserved" } };
    mocks.prisma.securityPolicy.create.mockResolvedValue(policy);

    const response = await fetch(baseUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Finance thresholds", config: policy.config })
    });

    expect(response.status).toBe(201);
    expect(mocks.prisma.securityPolicy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ config: policy.config, workspaceId: "workspace-1" })
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledOnce();
  });

  it("rejects invalid configured PO tolerance", async () => {
    const response = await fetch(baseUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bad thresholds", config: { poTolerancePercent: 120 } })
    });

    expect(response.status).toBe(400);
    expect(mocks.prisma.securityPolicy.create).not.toHaveBeenCalled();
  });

  it("lets an owner disable a scoped policy and increments its version", async () => {
    mocks.prisma.securityPolicy.findFirst
      .mockResolvedValueOnce({ id: "policy-1", workspaceId: "workspace-1", version: 2 })
      .mockResolvedValueOnce({ id: "policy-1", workspaceId: "workspace-1", version: 3, enabled: false, name: "Old limits" });
    mocks.prisma.securityPolicy.updateMany.mockResolvedValue({ count: 1 });

    const response = await fetch(`${baseUrl}/policy-1`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false })
    });

    expect(response.status).toBe(200);
    expect(mocks.prisma.securityPolicy.updateMany).toHaveBeenCalledWith({
      where: { id: "policy-1", workspaceId: "workspace-1", version: 2 },
      data: { enabled: false, version: { increment: 1 } }
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledOnce();
  });

  it("keeps policy management restricted to owners and admins", async () => {
    role = "EMPLOYEE";

    const response = await fetch(baseUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Unauthorized", config: { approvalLimit: 1000 } })
    });

    expect(response.status).toBe(403);
    expect(mocks.prisma.securityPolicy.create).not.toHaveBeenCalled();
  });
});
