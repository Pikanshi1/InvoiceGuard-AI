import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { requireRole } from "../middleware/workspace";
import { detectSupportedDocumentType, sanitizeDocumentFileName } from "../lib/uploaded-file";
import { parsePagination, paginate } from "../lib/pagination";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const allowedTypes = new Set(["application/pdf", "text/plain", "image/png", "image/jpeg"]);
const storageRoot = path.resolve(process.env.DOCUMENT_STORAGE_PATH ?? "storage/invoices");

export const quotationDocumentRouter = Router();

quotationDocumentRouter.get("/:quotationId/documents", async (req, res, next) => {
  try {
    const quotation = await prisma.quotation.findFirst({
      where: { id: String(req.params.quotationId), workspaceId: req.workspaceId },
      select: { id: true }
    });
    if (!quotation) return res.status(404).json({ error: "Quotation not found." });
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const where = { workspaceId: req.workspaceId, quotationId: quotation.id };
    const [documents, total] = await Promise.all([
      prisma.quotationDocument.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, contentHash: true, createdAt: true }
      }),
      prisma.quotationDocument.count({ where })
    ]);
    res.json(paginate(documents, total, page, limit));
  } catch (error) { next(error); }
});

quotationDocumentRouter.get("/:quotationId/documents/:documentId/download", async (req, res, next) => {
  try {
    const parent = await prisma.quotation.findFirst({
      where: { id: String(req.params.quotationId), workspaceId: req.workspaceId },
      select: { id: true }
    });
    if (!parent) return res.status(404).json({ error: "Quotation not found." });
    const document = await prisma.quotationDocument.findFirst({
      where: { id: String(req.params.documentId), workspaceId: req.workspaceId, quotationId: parent.id },
      select: { fileName: true, mimeType: true, storagePath: true }
    });
    if (!document) return res.status(404).json({ error: "Document not found." });
    const relativePath = path.relative(storageRoot, path.resolve(document.storagePath));
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return res.status(404).json({ error: "Document not found." });
    }
    await fs.access(document.storagePath);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(document.storagePath, document.fileName, error => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return res.status(404).json({ error: "Document file is unavailable." });
    }
    next(error);
  }
});

quotationDocumentRouter.post("/:quotationId/documents", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER"), uploadRateLimit, upload.single("document"), async (req, res, next) => {
  let storagePath: string | undefined;
  let storageFileCreated = false;
  let documentCreated = false;
  try {
    if (!req.file || !allowedTypes.has(req.file.mimetype)) {
      return res.status(400).json({ error: "Upload a PDF, text, PNG, or JPEG document." });
    }
    const detectedType = detectSupportedDocumentType(req.file.buffer);
    if (detectedType !== req.file.mimetype) {
      return res.status(400).json({ error: "The file contents do not match the declared document type." });
    }
    const quotation = await prisma.quotation.findFirst({
      where: { id: String(req.params.quotationId), workspaceId: req.workspaceId },
      select: { id: true }
    });
    if (!quotation) return res.status(404).json({ error: "Quotation not found." });

    const fileName = sanitizeDocumentFileName(req.file.originalname, detectedType);
    const contentHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    const directory = path.join(storageRoot, req.workspaceId!, "quotations", quotation.id);
    await fs.mkdir(directory, { recursive: true });
    storagePath = path.join(directory, `${contentHash.slice(0, 24)}${path.extname(fileName)}`);
    await fs.writeFile(storagePath, req.file.buffer, { flag: "wx" }).then(() => {
      storageFileCreated = true;
    }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });

    const document = await prisma.quotationDocument.create({
      data: {
        workspaceId: req.workspaceId!,
        quotationId: quotation.id,
        fileName,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        contentHash,
        storagePath
      },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true, contentHash: true, createdAt: true }
    });
    documentCreated = true;
    await recordAuditEvent({
      workspaceId: req.workspaceId!,
      actorId: req.userId,
      entityType: "QuotationDocument",
      entityId: document.id,
      action: "UPLOADED",
      metadata: { quotationId: quotation.id, contentHash }
    });
    res.status(201).json(document);
  } catch (error) {
    if (storagePath && storageFileCreated && !documentCreated) await fs.unlink(storagePath).catch(() => undefined);
    next(error);
  }
});
