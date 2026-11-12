import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    invoice: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    vendor: { findFirst: vi.fn() },
    securityPolicy: { findMany: vi.fn() }
  },
  recordAuditEvent: vi.fn(),
  indexWorkspaceRecord: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("../lib/search-index", () => ({ indexWorkspaceRecord: mocks.indexWorkspaceRecord }));

import { invoiceRouter } from "./invoices";
import { PAYMENT_DESTINATION_PENDING_NOTE } from "../lib/vendor-verification";

describe("invoice policy and three-way matching routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.prisma.invoice.count.mockResolvedValue(0);
    mocks.prisma.securityPolicy.findMany.mockResolvedValue([]);
    mocks.prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    mocks.recordAuditEvent.mockResolvedValue({ id: "audit-1" });
    mocks.indexWorkspaceRecord.mockResolvedValue(undefined);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = "finance-1";
      req.role = "FINANCE";
      next();
    });
    app.use("/api/invoices", invoiceRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/invoices`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("exports only active-workspace invoices and neutralizes spreadsheet formulas", async () => {
    mocks.prisma.invoice.findMany.mockResolvedValue([{
      invoiceNumber: "=HYPERLINK(\"https://bad.example\")",
      vendor: { name: "Example Vendor" },
      issueDate: null,
      dueDate: null,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      status: "PENDING",
      currency: "INR",
      amount: "125.50",
      taxAmount: "22.59",
      riskLevel: "LOW",
      riskScore: 0
    }]);

    const response = await fetch(baseUrl + "/export.csv?status=PENDING&minAmount=100");
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(csv).toContain("'=HYPERLINK");
    expect(mocks.prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId: "workspace-1", status: "PENDING", amount: { gte: 100 } }),
      take: 10000
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      action: "EXPORTED",
      metadata: expect.objectContaining({ count: 1 })
    }));
  });

  it("rejects invalid invoice export date and amount ranges", async () => {
    const invalidDates = await fetch(baseUrl + "/export.csv?from=2026-11-10&to=2026-11-01");
    expect(invalidDates.status).toBe(400);
    const invalidAmounts = await fetch(baseUrl + "/export.csv?minAmount=500&maxAmount=100");
    expect(invalidAmounts.status).toBe(400);
    expect(mocks.prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("routes invoices with a PO but no goods receipts to review", async () => {
    const invoice = {
      id: "invoice-1", workspaceId: "workspace-1", status: "PENDING", amount: 900, vendorId: "vendor-1", invoiceNumber: "INV-1",
      vendor: { verified: true }, purchaseOrder: { amount: 1000, receipts: [] }
    };
    mocks.prisma.invoice.findFirst
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce({ ...invoice, status: "REVIEW", evaluatedAt: new Date() });

    const response = await fetch(`${baseUrl}/invoice-1/evaluate`, { method: "POST" });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.decision).toBe("REVIEW");
    expect(result.reasons).toContain("No goods receipt is recorded for the purchase order.");
    expect(mocks.prisma.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "invoice-1", workspaceId: "workspace-1", status: "PENDING" },
      data: expect.objectContaining({ status: "REVIEW", evaluatedAt: expect.any(Date) })
    }));
  });

  it("applies the most restrictive enabled workspace policy thresholds", async () => {
    const invoice = {
      id: "invoice-2", workspaceId: "workspace-1", status: "PENDING", amount: 9000, vendorId: "vendor-1", invoiceNumber: "INV-2",
      vendor: { verified: true }, purchaseOrder: { amount: 10000, receipts: [{ orderedQty: 10, acceptedQty: 10 }] }
    };
    mocks.prisma.invoice.findFirst
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce({ ...invoice, status: "REVIEW", evaluatedAt: new Date() });
    mocks.prisma.securityPolicy.findMany.mockResolvedValue([
      { config: { approvalLimit: 15000, poTolerancePercent: 5 } },
      { config: { approvalLimit: 8000, poTolerancePercent: 4 } }
    ]);

    const response = await fetch(`${baseUrl}/invoice-2/evaluate`, { method: "POST" });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.decision).toBe("REVIEW");
    expect(result.reasons).toContain("Invoice exceeds the configured approval limit.");
    expect(mocks.prisma.securityPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: "workspace-1", enabled: true }, select: { config: true }
    }));
  });

  it("blocks an invoice while its vendor payment destination awaits independent verification", async () => {
    const invoice = {
      id: "invoice-destination", workspaceId: "workspace-1", status: "PENDING", amount: 900, vendorId: "vendor-1", invoiceNumber: "INV-DEST",
      vendor: { verified: true, verificationNote: PAYMENT_DESTINATION_PENDING_NOTE },
      purchaseOrder: { amount: 1000, receipts: [{ orderedQty: 10, acceptedQty: 10 }] }
    };
    mocks.prisma.invoice.findFirst
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce({ ...invoice, status: "BLOCKED", evaluatedAt: new Date() });

    const response = await fetch(`${baseUrl}/invoice-destination/evaluate`, { method: "POST" });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("Vendor payment destination has changed and needs independent verification.");
    expect(mocks.prisma.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "BLOCKED" })
    }));
  });

  it("registers an invoice with workspace and creator attribution", async () => {
    const vendor = { id: "vendor-1", workspaceId: "workspace-1", verified: true };
    const createdInvoice = { id: "invoice-1", workspaceId: "workspace-1", createdById: "finance-1", vendorId: "vendor-1", invoiceNumber: "INV-1", amount: 900 };
    mocks.prisma.vendor.findFirst.mockResolvedValue(vendor);
    mocks.prisma.invoice.create.mockResolvedValue(createdInvoice);

    const response = await fetch(baseUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendorId: "vendor-1", invoiceNumber: "INV-1", amount: 900, currency: "INR" })
    });

    expect(response.status, await response.text()).toBe(201);
    expect(mocks.prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      workspaceId: "workspace-1", createdById: "finance-1", vendorId: "vendor-1", currency: "INR"
    }) }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledOnce();
    expect(mocks.indexWorkspaceRecord).toHaveBeenCalledOnce();
  });

  it("does not mark a partially accepted purchase order as three-way matched", async () => {
    mocks.prisma.invoice.findFirst.mockResolvedValue({
      id: "invoice-1", workspaceId: "workspace-1", amount: 900,
      purchaseOrder: { id: "po-1", amount: 1000, receipts: [{ orderedQty: 10, receivedQty: 4, acceptedQty: 4 }] }
    });

    const response = await fetch(`${baseUrl}/invoice-1/match`);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.decision).toBe("REVIEW");
    expect(result.checks.receipt).toBe(false);
    expect(result.receivedQty).toBe(4);
    expect(result.orderedQty).toBe(10);
  });

  it("marks fully accepted cumulative receipt quantities as matched", async () => {
    mocks.prisma.invoice.findFirst.mockResolvedValue({
      id: "invoice-1", workspaceId: "workspace-1", amount: 900,
      purchaseOrder: { id: "po-1", amount: 1000, receipts: [
        { orderedQty: 10, receivedQty: 4, acceptedQty: 4 },
        { orderedQty: 10, receivedQty: 6, acceptedQty: 6 }
      ] }
    });

    const response = await fetch(`${baseUrl}/invoice-1/match`);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.decision).toBe("MATCHED");
    expect(result.checks.receipt).toBe(true);
  });

  it("fails closed when legacy receipt rows disagree on ordered quantities", async () => {
    mocks.prisma.invoice.findFirst.mockResolvedValue({
      id: "invoice-1", workspaceId: "workspace-1", amount: 900,
      purchaseOrder: { id: "po-1", amount: 1000, receipts: [
        { orderedQty: 10, receivedQty: 10, acceptedQty: 10 },
        { orderedQty: 2, receivedQty: 2, acceptedQty: 2 }
      ] }
    });

    const response = await fetch(`${baseUrl}/invoice-1/match`);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.decision).toBe("REVIEW");
    expect(result.checks.receipt).toBe(false);
  });
});
