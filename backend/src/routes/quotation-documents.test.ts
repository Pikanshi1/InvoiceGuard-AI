import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    quotation: { findFirst: vi.fn() },
    quotationDocument: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() }
  },
  fs: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn(), access: vi.fn() },
  recordAuditEvent: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("node:fs/promises", () => ({ ...mocks.fs, default: mocks.fs }));

import { quotationDocumentRouter } from "./quotation-documents";

describe("quotation document routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.prisma.quotation.findFirst.mockResolvedValue({ id: "quotation-1" });
    mocks.prisma.quotationDocument.findMany.mockResolvedValue([]);
    mocks.prisma.quotationDocument.count.mockResolvedValue(0);
    mocks.prisma.quotationDocument.create.mockResolvedValue({
      id: "document-1", fileName: "quote.txt", mimeType: "text/plain", sizeBytes: 11,
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
    app.use("/api/procurement/quotations", quotationDocumentRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error." });
    });
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/procurement/quotations`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("stores quotation evidence with workspace attribution and an audit event", async () => {
    const form = new FormData();
    form.append("document", new Blob(["quotation"], { type: "text/plain" }), "quotation.txt");

    const response = await fetch(`${baseUrl}/quotation-1/documents`, { method: "POST", body: form });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.fileName).toBe("quote.txt");
    expect(mocks.prisma.quotationDocument.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workspaceId: "workspace-1", quotationId: "quotation-1", mimeType: "text/plain" })
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledOnce();
  });

  it("does not expose quotation evidence from another workspace", async () => {
    mocks.prisma.quotation.findFirst.mockResolvedValueOnce(null);

    const response = await fetch(`${baseUrl}/foreign-quotation/documents`);

    expect(response.status).toBe(404);
    expect(mocks.prisma.quotationDocument.findMany).not.toHaveBeenCalled();
  });
});
