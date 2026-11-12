import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    invoice: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    invoiceDocument: { findFirst: vi.fn(), create: vi.fn() }
  },
  fs: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn(), readFile: vi.fn() },
  recordAuditEvent: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("node:fs/promises", () => ({ ...mocks.fs, default: mocks.fs }));

import { documentRouter } from "./documents";

let testUserSequence = 0;

describe("invoice document uploads", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.prisma.invoice.findFirst.mockResolvedValue({ id: "invoice-1", workspaceId: "workspace-1" });
    mocks.prisma.invoice.count.mockResolvedValue(0);
    mocks.prisma.invoice.update.mockResolvedValue({ id: "invoice-1", extractedData: {} });
    mocks.prisma.invoiceDocument.findFirst.mockResolvedValue(null);
    mocks.prisma.invoiceDocument.create.mockResolvedValue({
      id: "document-1", version: 1, fileName: "invoice.txt", mimeType: "text/plain", sizeBytes: 12,
      contentHash: "hash", createdAt: new Date("2026-01-01T00:00:00Z")
    });
    mocks.fs.mkdir.mockResolvedValue(undefined);
    mocks.fs.writeFile.mockResolvedValue(undefined);
    mocks.fs.unlink.mockResolvedValue(undefined);
    mocks.recordAuditEvent.mockResolvedValue({ id: "audit-1" });

    const testUserId = `finance-test-${++testUserSequence}`;
    const app = express();
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = testUserId;
      req.role = "FINANCE";
      next();
    });
    app.use("/api/invoices", documentRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error." });
    });
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/invoices`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("accepts supported text by its contents and stores a sanitized filename", async () => {
    const form = new FormData();
    form.append("document", new Blob(["invoice data"], { type: "text/plain" }), "../../invoice.txt");

    const response = await fetch(`${baseUrl}/invoice-1/documents`, { method: "POST", body: form });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.fileName).toBe("invoice.txt");
    expect(mocks.fs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), { flag: "wx" });
    expect(mocks.prisma.invoiceDocument.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fileName: "invoice.txt", mimeType: "text/plain" }) }));
  });

  it("rejects file contents that do not match the declared MIME type", async () => {
    const form = new FormData();
    form.append("document", new Blob(["not a png"], { type: "image/png" }), "invoice.png");

    const response = await fetch(`${baseUrl}/invoice-1/documents`, { method: "POST", body: form });

    expect(response.status).toBe(400);
    expect(mocks.prisma.invoice.findFirst).not.toHaveBeenCalled();
    expect(mocks.fs.writeFile).not.toHaveBeenCalled();
  });

  it("extracts and validates structured invoice JSON from a text document", async () => {
    mocks.prisma.invoiceDocument.findFirst.mockResolvedValueOnce({
      id: "document-1",
      mimeType: "text/plain",
      storagePath: "/safe/invoice.txt",
      invoice: {
        workspaceId: "workspace-1", invoiceNumber: "INV-42", vendorId: "vendor-1",
        currency: "INR", amount: 118, vendor: { name: "Example Supplies" }
      }
    });
    mocks.fs.readFile.mockResolvedValue(JSON.stringify({
      invoiceNumber: "INV-42", vendorName: "Example Supplies", currency: "INR",
      subtotal: 100, taxAmount: 18, totalAmount: 118, lineItems: []
    }));

    const response = await fetch(baseUrl + "/invoice-1/documents/document-1/extract", { method: "POST" });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.extractedData).toMatchObject({
      invoiceNumber: "INV-42",
      totalAmount: 118,
      extractionMethod: "plain-text-json",
      fieldValidation: { matchesRegisteredInvoice: true, duplicateInvoiceNumber: false, warnings: [] }
    });
    expect(mocks.prisma.invoice.update).toHaveBeenCalledOnce();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "EXTRACTED",
      metadata: expect.objectContaining({ method: "plain-text-json" })
    }));
  });

  it("does not read a document attached to an invoice in another workspace", async () => {
    mocks.prisma.invoiceDocument.findFirst.mockResolvedValueOnce({
      id: "document-foreign", mimeType: "text/plain", storagePath: "/outside/invoice.txt",
      invoice: { workspaceId: "workspace-elsewhere" }
    });

    const response = await fetch(baseUrl + "/invoice-1/documents/document-foreign/extract", { method: "POST" });

    expect(response.status).toBe(404);
    expect(mocks.fs.readFile).not.toHaveBeenCalled();
    expect(mocks.prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("forwards extraction lookup failures to Express error handling", async () => {
    mocks.prisma.invoiceDocument.findFirst.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await fetch(`${baseUrl}/invoice-1/documents/document-1/extract`, { method: "POST" });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "database unavailable" });
  });

  it("limits repeated document extraction requests per authenticated user", async () => {
    const responses: Response[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      responses.push(await fetch(`${baseUrl}/invoice-1/documents/document-1/extract`, { method: "POST" }));
    }

    expect(responses.slice(0, 10).every(response => response.status === 404)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(await responses[10].json()).toEqual({ error: "Too many requests. Please try again later." });
  });
});
