import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    approval: { findFirst: vi.fn(), create: vi.fn() },
    invoice: { findFirst: vi.fn() },
    $transaction: vi.fn()
  },
  recordAuditEvent: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));

import { governanceRouter } from "./governance";

describe("invoice approval routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = "approver-1";
      req.role = "FINANCE";
      next();
    });
    app.use("/api/governance", governanceRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/governance`;
    mocks.recordAuditEvent.mockResolvedValue({ id: "audit-1" });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("does not create an approval before policy evaluation", async () => {
    mocks.prisma.invoice.findFirst.mockResolvedValue({ id: "invoice-1", status: "PENDING", evaluatedAt: null });
    const response = await fetch(`${baseUrl}/approvals`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId: "invoice-1" })
    });
    expect(response.status).toBe(409);
    expect(mocks.prisma.approval.create).not.toHaveBeenCalled();
  });

  it("rejects creator self-approval", async () => {
    mocks.prisma.approval.findFirst.mockResolvedValue({
      id: "approval-1", status: "PENDING", invoiceId: "invoice-1",
      invoice: { id: "invoice-1", status: "PENDING", createdById: "approver-1", evaluatedAt: new Date() }
    });
    const response = await fetch(`${baseUrl}/approvals/approval-1`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "APPROVED" })
    });
    expect(response.status).toBe(409);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows an evaluated invoice to be approved by a different member", async () => {
    const approval = {
      id: "approval-1", status: "PENDING", invoiceId: "invoice-1",
      invoice: { id: "invoice-1", status: "REVIEW", createdById: "creator-1", evaluatedAt: new Date() }
    };
    mocks.prisma.approval.findFirst.mockResolvedValue(approval);
    const tx = {
      approval: {
        findFirst: vi.fn().mockResolvedValue(approval),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "approval-1", status: "APPROVED" })
      },
      invoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const response = await fetch(`${baseUrl}/approvals/approval-1`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "APPROVED" })
    });
    expect(response.status).toBe(200);
    expect(tx.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ evaluatedAt: { not: null }, createdById: { not: "approver-1" } }),
      data: { status: "APPROVED" }
    }));
  });
});
