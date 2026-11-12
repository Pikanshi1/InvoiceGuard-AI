import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { requireRole } from "../middleware/workspace";
import type { Prisma } from "@prisma/client";
import { detectSupportedDocumentType, sanitizeDocumentFileName } from "../lib/uploaded-file";
import { createAuthenticatedRateLimit } from "../middleware/rate-limit";
import { parsePagination, paginate } from "../lib/pagination";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const extractionRateLimit = createAuthenticatedRateLimit(10);
const documentRouter = Router();
const allowedTypes = new Set(["application/pdf", "text/plain", "image/png", "image/jpeg"]);
const storageRoot = path.resolve(process.env.DOCUMENT_STORAGE_PATH ?? "storage/invoices");

async function fetchGeminiWithRetry(url: string, init: RequestInit, attempts = 3) {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      if (![429, 500, 502, 503, 504].includes(response.status)) return response;
      lastResponse = response;
      if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
    } catch {
      if (attempt === attempts - 1) throw new Error("Gemini request failed.");
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  if (lastResponse) return lastResponse;
  throw new Error("Gemini request failed.");
}

documentRouter.post("/:invoiceId/documents", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER"), uploadRateLimit, upload.single("document"), async (req, res, next) => {
  let storagePath: string | undefined;
  let storageFileCreated = false;
  let documentCreated = false;
  try {
    if (!req.file || !allowedTypes.has(req.file.mimetype)) return res.status(400).json({ error: "Upload a PDF, text, PNG, or JPEG document." });
    const detectedType = detectSupportedDocumentType(req.file.buffer);
    if (detectedType !== req.file.mimetype) return res.status(400).json({ error: "The file contents do not match the declared document type." });
    const invoiceId = String(req.params.invoiceId);
    const safeOriginalName = sanitizeDocumentFileName(req.file.originalname, detectedType);
    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId: req.workspaceId } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found in this workspace." });
    const contentHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    const duplicate = await prisma.invoiceDocument.findFirst({ where: { invoiceId, contentHash }, select: { id: true } });
    if (duplicate) return res.status(409).json({ error: "This exact document has already been uploaded for the invoice." });
    const latest = await prisma.invoiceDocument.findFirst({ where: { invoiceId }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;
    const directory = path.join(storageRoot, req.workspaceId!);
    await fs.mkdir(directory, { recursive: true });
    storagePath = path.join(directory, `${invoiceId}-v${version}-${contentHash.slice(0, 12)}${path.extname(safeOriginalName)}`);
    await fs.writeFile(storagePath, req.file.buffer, { flag: "wx" });
    storageFileCreated = true;
    const document = await prisma.invoiceDocument.create({ data: { invoiceId, version, fileName: safeOriginalName, mimeType: req.file.mimetype, sizeBytes: req.file.size, contentHash, storagePath } });
    documentCreated = true;
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "InvoiceDocument", entityId: document.id, action: "UPLOADED", metadata: { invoiceId, version, contentHash } });
    res.status(201).json({ id: document.id, version, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.sizeBytes, contentHash, createdAt: document.createdAt });
  } catch (error) {
    if (storagePath && storageFileCreated && !documentCreated) await fs.unlink(storagePath).catch(() => undefined);
    next(error);
  }
});

documentRouter.get("/:invoiceId/documents/:documentId/download", async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: String(req.params.invoiceId), workspaceId: req.workspaceId },
      select: { id: true }
    });
    if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    const document = await prisma.invoiceDocument.findFirst({
      where: { id: String(req.params.documentId), invoiceId: invoice.id },
      select: { fileName: true, mimeType: true, storagePath: true }
    });
    if (!document) return res.status(404).json({ error: "Invoice document not found." });
    const relativePath = path.relative(storageRoot, path.resolve(document.storagePath));
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return res.status(404).json({ error: "Invoice document not found." });
    }
    await fs.access(document.storagePath);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(document.storagePath, document.fileName, error => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return res.status(404).json({ error: "Invoice document file is unavailable." });
    }
    next(error);
  }
});

documentRouter.get("/:invoiceId/documents", async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const invoice = await prisma.invoice.findFirst({ where: { id: String(req.params.invoiceId), workspaceId: req.workspaceId } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found in this workspace." });
    const where = { invoiceId: invoice.id };
    const [documents, total] = await Promise.all([
      prisma.invoiceDocument.findMany({ where, orderBy: { version: "desc" }, skip, take: limit, select: { id: true, version: true, fileName: true, mimeType: true, sizeBytes: true, contentHash: true, createdAt: true } }),
      prisma.invoiceDocument.count({ where }),
    ]);
    res.json(paginate(documents, total, page, limit));
  } catch (error) { next(error); }
});

documentRouter.post("/:invoiceId/documents/:documentId/extract", requireRole("OWNER", "ADMIN", "FINANCE", "MANAGER"), extractionRateLimit, async (req, res, next) => {
  try {
    const invoiceId = String(req.params.invoiceId);
    const document = await prisma.invoiceDocument.findFirst({
      where: { id: String(req.params.documentId), invoiceId },
      include: { invoice: { include: { vendor: { select: { name: true } } } } }
    });
    if (!document || document.invoice.workspaceId !== req.workspaceId) return res.status(404).json({ error: "Invoice document not found." });

    const { extractDocumentText, validateInvoiceExtraction } = await import("../lib/document-extraction.js");
    let extractedText: string;
    let method: string;
    try {
      const extraction = await extractDocumentText(document.storagePath, document.mimeType);
      extractedText = extraction.text;
      method = extraction.method;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The document could not be read.";
      return res.status(422).json({ error: message });
    }

    let extractedData: Record<string, unknown> | null = null;
    if (document.mimeType === "text/plain") {
      let parsed: unknown;
      try { parsed = JSON.parse(extractedText) as unknown; }
      catch { parsed = null; }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        try { extractedData = validateInvoiceExtraction(parsed); }
        catch (error) { return res.status(422).json({ error: error instanceof Error ? error.message : "The structured invoice fields are invalid." }); }
        method = "plain-text-json";
      }
    }
    if (!extractedData) {
      if ((process.env.AI_PROVIDER ?? "gemini").toLowerCase() !== "gemini" || !process.env.AI_API_KEY || !process.env.AI_BASE_URL || !process.env.AI_MODEL) {
        return res.status(503).json({ error: "Document text was read, but structured invoice extraction requires configured Gemini credentials." });
      }
      const response = await fetchGeminiWithRetry(`${process.env.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.AI_MODEL,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: "Extract invoice data only from the supplied document text. Return exactly one JSON object with keys invoiceNumber, vendorName, issueDate, dueDate, currency, subtotal, taxAmount, totalAmount, lineItems. Use null for unknown scalar fields and [] for lineItems. Amounts must be decimal numbers or null. Dates must be parseable date strings or null. Each line item has description, quantity, unitPrice, amount. Do not infer, calculate, guess, approve, or assign risk. Do not include markdown or extra keys."
            },
            { role: "user", content: `Extract the invoice fields from this OCR/text output. Preserve the source values; use null when uncertain.\n\n${extractedText.slice(0, 30000)}` }
          ]
        })
      });
      if (!response.ok) return res.status([429, 500, 502, 503, 504].includes(response.status) ? 503 : 502).json({ error: "Gemini invoice extraction is temporarily unavailable. The document text was not saved as invoice fields." });
      let result: { choices?: { message?: { content?: string } }[] };
      try { result = await response.json() as typeof result; }
      catch { return res.status(502).json({ error: "Gemini returned an invalid extraction response." }); }
      const content = result.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) return res.status(502).json({ error: "Gemini returned no structured invoice fields." });
      try {
        const normalized = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
        extractedData = validateInvoiceExtraction(JSON.parse(normalized));
      } catch (error) {
        const message = error instanceof Error ? error.message : "The extraction response was invalid.";
        return res.status(422).json({ error: message.includes("failed invoice validation") || message.includes("date is invalid") || message.includes("do not match") ? message : "Gemini returned malformed invoice fields. No extracted data was saved." });
      }
    }

    if (!extractedData) {
      return res.status(422).json({ error: "Structured invoice extraction did not produce valid fields. Review the source document and retry." });
    }

    const validationWarnings: string[] = [];
    const normalized = (value: unknown) => typeof value === "string" ? value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "") : "";
    if (extractedData.invoiceNumber && normalized(extractedData.invoiceNumber) !== normalized(document.invoice.invoiceNumber)) {
      validationWarnings.push("Extracted invoice number differs from the registered invoice number.");
    }
    if (extractedData.vendorName && normalized(extractedData.vendorName) !== normalized(document.invoice.vendor.name)) {
      validationWarnings.push("Extracted vendor name differs from the registered vendor.");
    }
    const extractedTotal = typeof extractedData.totalAmount === "number" ? extractedData.totalAmount : null;
    if (extractedTotal !== null && Math.abs(extractedTotal - Number(document.invoice.amount)) > 0.02) {
      validationWarnings.push("Extracted total differs from the registered invoice amount.");
    }
    const extractedCurrency = typeof extractedData.currency === "string" ? extractedData.currency.toUpperCase() : null;
    if (extractedCurrency && extractedCurrency !== document.invoice.currency.toUpperCase()) {
      validationWarnings.push("Extracted currency differs from the registered invoice currency.");
    }
    const duplicateInvoice = extractedData.invoiceNumber
      ? await prisma.invoice.count({
          where: {
            workspaceId: req.workspaceId,
            vendorId: document.invoice.vendorId,
            invoiceNumber: String(extractedData.invoiceNumber),
            NOT: { id: invoiceId }
          }
        }) > 0
      : false;
    if (duplicateInvoice) validationWarnings.push("Another invoice for this vendor uses the extracted invoice number.");
    const requiredFieldsPresent = Boolean(extractedData.invoiceNumber && extractedData.vendorName && extractedData.totalAmount !== null && extractedData.totalAmount !== undefined);
    if (!extractedData.invoiceNumber) validationWarnings.push("Invoice number was not detected; review the source document.");
    if (!extractedData.vendorName) validationWarnings.push("Vendor name was not detected; review the source document.");
    if (extractedData.totalAmount === null || extractedData.totalAmount === undefined) validationWarnings.push("Invoice total was not detected; review the source document.");
    const fieldValidation = {
      status: requiredFieldsPresent && validationWarnings.length === 0 ? "MATCH" : "REVIEW",
      matchesRegisteredInvoice: requiredFieldsPresent && validationWarnings.length === 0,
      duplicateInvoiceNumber: duplicateInvoice,
      warnings: validationWarnings
    };
    const storedData = {
      ...extractedData,
      extractionMethod: method,
      fieldValidation,
      sourceText: extractedText.slice(0, 30000)
    };
    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { extractedData: storedData as Prisma.InputJsonValue }
    });
    await recordAuditEvent({
      workspaceId: req.workspaceId!,
      actorId: req.userId,
      entityType: "Invoice",
      entityId: invoiceId,
      action: "EXTRACTED",
      metadata: { documentId: document.id, method, fieldCount: Object.keys(extractedData).length, validationWarnings, duplicateInvoice }
    });
    res.json({ invoiceId, documentId: document.id, extractedData: storedData, invoice: updated });
  } catch (error) { next(error); }
});

export { documentRouter };
