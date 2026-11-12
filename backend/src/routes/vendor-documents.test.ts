import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    vendor: { findFirst: vi.fn() },
    vendorDocument: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() }
  },
  fs: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn(), access: vi.fn() },
  recordAuditEvent: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("node:fs/promises", () => ({ ...mocks.fs, default: mocks.fs }));

import { vendorDocumentRouter } from "./vendor-documents";

describe("vendor document routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.prisma.vendor.findFirst.mockResolvedValue({ id: "vendor-1", workspaceId: "workspace-1" });
    mocks.prisma.vendorDocument.findFirst.mockResolvedValue(null);
    mocks.prisma.vendorDocument.findMany.mockResolvedValue([]);
    mocks.prisma.vendorDocument.count.mockResolvedValue(0);
    mocks.prisma.vendorDocument.create.mockResolvedValue({
      id: "document-1", fileName: "proof.txt", mimeType: "text/plain", sizeBytes: 12,
      contentHash: "hash", createdAt: new Date("2026-01-01T00:00:00Z")
    });
    mocks.fs.mkdir.mockResolvedValue(undefined);
    mocks.fs.writeFile.mockResolvedValue(undefined);
    mocks.fs.unlink.mockResolvedValue(undefined);
    mocks.fs.access.mockResolvedValue(undefined);
    mocks.recordAuditEvent.mockResolvedValue({ id: "audit-1" });

    const app = express();
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = "finance-1";
      req.role = "FINANCE";
      next();
    });
    app.use("/api/vendors", vendorDocumentRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error." });
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

  it("stores a supported vendor document and records its audit event", async () => {
    const form = new FormData();
    form.append("document", new Blob(["vendor proof"], { type: "text/plain" }), "../../proof.txt");

    const response = await fetch(`${baseUrl}/vendor-1/documents`, { method: "POST", body: form });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.fileName).toBe("proof.txt");
    expect(mocks.fs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), { flag: "wx" });
    expect(mocks.prisma.vendorDocument.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workspaceId: "workspace-1", vendorId: "vendor-1", fileName: "proof.txt", mimeType: "text/plain" })
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledOnce();
  });

  it("rejects a document whose content does not match its MIME type", async () => {
    const form = new FormData();
    form.append("document", new Blob(["not a png"], { type: "image/png" }), "proof.png");

    const response = await fetch(`${baseUrl}/vendor-1/documents`, { method: "POST", body: form });

    expect(response.status).toBe(400);
    expect(mocks.prisma.vendorDocument.create).not.toHaveBeenCalled();
    expect(mocks.fs.writeFile).not.toHaveBeenCalled();
  });

  it("does not reveal documents belonging to a vendor outside the active workspace", async () => {
    mocks.prisma.vendor.findFirst.mockResolvedValueOnce(null);

    const response = await fetch(`${baseUrl}/foreign-vendor/documents`);

    expect(response.status).toBe(404);
    expect(mocks.prisma.vendorDocument.findMany).not.toHaveBeenCalled();
  });

  it("rejects access to a document path outside the configured storage root", async () => {
    mocks.prisma.vendorDocument.findFirst.mockResolvedValueOnce({
      fileName: "proof.txt",
      mimeType: "text/plain",
      storagePath: "/tmp/untrusted/proof.txt"
    });

    const response = await fetch(`${baseUrl}/vendor-1/documents/document-1/download`);

    expect(response.status).toBe(404);
    expect(mocks.fs.access).not.toHaveBeenCalled();
  });
});
