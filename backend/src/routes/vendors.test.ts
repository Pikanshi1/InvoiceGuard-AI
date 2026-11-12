import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    vendor: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn()
    },
    $transaction: vi.fn()
  },
  recordAuditEventInTransaction: vi.fn(),
  indexWorkspaceRecord: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEventInTransaction: mocks.recordAuditEventInTransaction }));
vi.mock("../lib/search-index", () => ({ indexWorkspaceRecord: mocks.indexWorkspaceRecord }));

import { vendorRouter } from "./vendors";
import { PAYMENT_DESTINATION_PENDING_NOTE } from "../lib/vendor-verification";

describe("vendor payment destination verification", () => {
  let server: Server;
  let baseUrl: string;
  let role: "FINANCE" | "OWNER" | "EMPLOYEE";
  let userId: string;
let tx: {
  vendor: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  invoice: {
    updateMany: ReturnType<typeof vi.fn>;
  };
  auditEvent: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
};

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.prisma.vendor.count.mockResolvedValue(0);
    role = "FINANCE";
    userId = "finance-1";
    tx = {
      vendor: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    invoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { findFirst: vi.fn() },
      $queryRaw: vi.fn()
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    mocks.recordAuditEventInTransaction.mockResolvedValue({ id: "audit-1" });
    mocks.indexWorkspaceRecord.mockResolvedValue(undefined);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = userId;
      req.role = role;
      next();
    });
    app.use("/api/vendors", vendorRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error && typeof error === "object" && "issues" in error) return res.status(400).json({ error: "Validation failed" });
      return res.status(500).json({ error: "Unexpected server error." });
    });
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/vendors`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("hides tax and payment destination details from regular workspace members", async () => {
    role = "EMPLOYEE";
    mocks.prisma.vendor.findMany.mockResolvedValue([]);

    const response = await fetch(baseUrl);

    expect(response.status).toBe(200);
    expect(mocks.prisma.vendor.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, name: true, email: true, verified: true }
    }));
  });

  it("restricts destination changes to OWNER, ADMIN, and FINANCE", async () => {
    role = "EMPLOYEE";

    const response = await fetch(`${baseUrl}/vendor-1/payment-destination`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ bankAccountLast4: "2222" })
    });

    expect(response.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("restricts vendor verification to OWNER and ADMIN", async () => {
    const response = await fetch(`${baseUrl}/vendor-1/verification`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ verificationNote: "Confirmed with vendor" })
    });

    expect(response.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("records a changed destination as unverified and appends the audit event atomically", async () => {
    const updatedAt = new Date("2026-01-01T00:00:00Z");
    tx.vendor.findFirst
      .mockResolvedValueOnce({ id: "vendor-1", workspaceId: "workspace-1", bankAccountLast4: "1111", verified: true, updatedAt })
      .mockResolvedValueOnce({ id: "vendor-1", workspaceId: "workspace-1", bankAccountLast4: "2222", verified: false, verificationNote: PAYMENT_DESTINATION_PENDING_NOTE });
    tx.vendor.updateMany.mockResolvedValue({ count: 1 });

    const response = await fetch(`${baseUrl}/vendor-1/payment-destination`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ bankAccountLast4: "2222" })
    });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ bankAccountLast4: "2222", verified: false, verificationNote: PAYMENT_DESTINATION_PENDING_NOTE });
    expect(tx.vendor.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "vendor-1", workspaceId: "workspace-1", updatedAt },
      data: { bankAccountLast4: "2222", verified: false, verificationNote: PAYMENT_DESTINATION_PENDING_NOTE }
    }));
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1", vendorId: "vendor-1", status: { in: ["PENDING", "REVIEW", "BLOCKED", "APPROVED"] } },
      data: { status: "REVIEW", evaluatedAt: null }
    });
    expect(mocks.recordAuditEventInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "PAYMENT_DESTINATION_CHANGED" }));
  });

  it("prevents the person who changed the destination from verifying it", async () => {
    role = "OWNER";
    userId = "finance-1";
    const updatedAt = new Date("2026-01-01T00:00:00Z");
    tx.vendor.findFirst.mockResolvedValue({
      id: "vendor-1", workspaceId: "workspace-1", bankAccountLast4: "2222", verified: false,
      verificationNote: PAYMENT_DESTINATION_PENDING_NOTE, updatedAt
    });
    tx.auditEvent.findFirst.mockResolvedValue({
      action: "PAYMENT_DESTINATION_CHANGED", actorId: "finance-1", createdAt: new Date(updatedAt.getTime() + 1)
    });

    const response = await fetch(`${baseUrl}/vendor-1/verification`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ verificationNote: "Confirmed with vendor" })
    });

    expect(response.status).toBe(403);
    expect(tx.vendor.updateMany).not.toHaveBeenCalled();
  });

  it("allows a different owner to verify a current destination change", async () => {
    role = "OWNER";
    userId = "owner-2";
    const updatedAt = new Date("2026-01-01T00:00:00Z");
    tx.vendor.findFirst
      .mockResolvedValueOnce({
        id: "vendor-1", workspaceId: "workspace-1", bankAccountLast4: "2222", verified: false,
        verificationNote: PAYMENT_DESTINATION_PENDING_NOTE, updatedAt
      })
      .mockResolvedValueOnce({ id: "vendor-1", workspaceId: "workspace-1", bankAccountLast4: "2222", verified: true, verificationNote: "Confirmed with vendor" });
    tx.auditEvent.findFirst.mockResolvedValue({
      action: "PAYMENT_DESTINATION_CHANGED", actorId: "finance-1", createdAt: new Date(updatedAt.getTime() + 1)
    });
    tx.vendor.updateMany.mockResolvedValue({ count: 1 });

    const response = await fetch(`${baseUrl}/vendor-1/verification`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ verificationNote: "Confirmed with vendor" })
    });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ verified: true, verificationNote: "Confirmed with vendor" });
    expect(mocks.recordAuditEventInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "PAYMENT_DESTINATION_VERIFIED" }));
  });

  it("rejects destination values that are not exactly four digits", async () => {
    const response = await fetch(`${baseUrl}/vendor-1/payment-destination`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ bankAccountLast4: "12345" })
    });

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
