import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import fs from "node:fs/promises";

const execFile = promisify(execFileCallback);
const MAX_OCR_PAGES = 5;
const MAX_TEXT_LENGTH = 40_000;

export type DocumentTextResult = {
  text: string;
  method: "pdf-text" | "pdf-ocr" | "image-ocr" | "plain-text";
  pageCount?: number;
};

async function run(command: string, args: string[], timeout = 60_000) {
  try {
    return await execFile(command, args, { timeout, maxBuffer: 5 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT") throw new Error("Document extraction tools are not installed. Install Poppler (pdftotext/pdftoppm) and Tesseract OCR, then retry.");
    if (code === "ETIMEDOUT" || code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new Error("Document extraction exceeded its processing limit. Try a smaller or clearer document.");
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    if (command === "tesseract") {
      // Classify known failures without exposing raw stderr, file paths, or invoice data.
      const diagnostic = /Failed loading language|Error opening data file/i.test(stderr)
        ? "language-data"
        : /pixRead|PNG|JPEG|image file|image type/i.test(stderr)
          ? "image-decode"
          : "ocr-engine";
      const guidance = diagnostic === "language-data"
        ? "Verify the configured OCR language is installed."
        : diagnostic === "image-decode"
          ? "Verify the upload is a valid PNG/JPEG image."
          : "Try a clearer, supported image.";
      throw new Error(`Tesseract OCR failed (${diagnostic}). ${guidance}`);
    }
    throw new Error("The document could not be read. It may be damaged, encrypted, or unsupported.");
  }
}

async function ocrImage(filePath: string) {
  const result = await run("tesseract", [filePath, "stdout", "-l", process.env.OCR_LANGUAGES ?? "eng", "--psm", "6"], 90_000);
  return result.stdout.trim();
}

export async function extractDocumentText(filePath: string, mimeType: string): Promise<DocumentTextResult> {
  if (mimeType === "text/plain") {
    const text = (await fs.readFile(filePath, "utf8")).slice(0, MAX_TEXT_LENGTH).trim();
    if (!text) throw new Error("The text document is empty.");
    return { text, method: "plain-text" };
  }

  if (mimeType === "image/png" || mimeType === "image/jpeg") {
    const text = await ocrImage(filePath);
    if (text.length < 12) throw new Error("No readable invoice text was detected in this image. Upload a clearer image.");
    return { text: text.slice(0, MAX_TEXT_LENGTH), method: "image-ocr" };
  }

  if (mimeType !== "application/pdf") throw new Error("Unsupported document type. Upload a PDF, PNG, JPEG, or TXT file.");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "invoiceguard-ocr-"));
  try {
    const pdfText = await run("pdftotext", ["-f", "1", "-l", String(MAX_OCR_PAGES), "-layout", filePath, "-"]);
    const normalized = pdfText.stdout.replace(/\u0000/g, "").trim();
    if (normalized.length >= 40) {
      return { text: normalized.slice(0, MAX_TEXT_LENGTH), method: "pdf-text", pageCount: Math.min(MAX_OCR_PAGES, (normalized.match(/\f/g) ?? []).length + 1) };
    }

    const prefix = path.join(directory, "page");
    await run("pdftoppm", ["-f", "1", "-l", String(MAX_OCR_PAGES), "-r", "200", "-png", filePath, prefix], 90_000);
    const pages = (await fs.readdir(directory)).filter(name => /^page-\d+\.png$/i.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    if (pages.length === 0) throw new Error("No pages could be rendered from this PDF. It may be encrypted or damaged.");
    const pageText: string[] = [];
    for (const page of pages.slice(0, MAX_OCR_PAGES)) {
      const text = await ocrImage(path.join(directory, page));
      if (text) pageText.push(text);
    }
    const text = pageText.join("\n\n").slice(0, MAX_TEXT_LENGTH);
    if (text.length < 12) throw new Error("No readable invoice text was detected in this PDF. Check the scan quality and retry.");
    return { text, method: "pdf-ocr", pageCount: pages.length };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export function validateInvoiceExtraction(value: unknown) {
  const money = z.union([z.number().finite().nonnegative(), z.string().trim().regex(/^\d+(\.\d{1,2})?$/)]).nullable().optional();
  const optionalText = z.string().trim().max(300).nullable().optional();
  const schema = z.object({
    invoiceNumber: optionalText,
    vendorName: optionalText,
    issueDate: optionalText,
    dueDate: optionalText,
    currency: z.string().trim().length(3).transform(value => value.toUpperCase()).nullable().optional(),
    subtotal: money,
    taxAmount: money,
    totalAmount: money,
    lineItems: z.array(z.object({
      description: z.string().trim().max(500),
      quantity: z.number().finite().positive().nullable().optional(),
      unitPrice: money,
      amount: money
    })).max(100).optional()
  }).strict();
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("The extraction provider returned fields that failed invoice validation. No extracted fields were saved.");
  const data = parsed.data;
  for (const key of ["issueDate", "dueDate"] as const) {
    const date = data[key];
    if (date && Number.isNaN(Date.parse(date))) throw new Error("An extracted invoice date is invalid. Review the document and retry.");
  }
  const toNumber = (amount: string | number | null | undefined) => amount == null ? null : Number(amount);
  const subtotal = toNumber(data.subtotal);
  const tax = toNumber(data.taxAmount);
  const total = toNumber(data.totalAmount);
  if (subtotal !== null && tax !== null && total !== null && Math.abs(subtotal + tax - total) > 0.02) {
    throw new Error("Extracted subtotal and tax do not match the total. Review the invoice fields before using them.");
  }
  return {
    ...data,
    subtotal,
    taxAmount: tax,
    totalAmount: total,
    lineItems: data.lineItems?.map(item => ({
      ...item,
      unitPrice: toNumber(item.unitPrice),
      amount: toNumber(item.amount)
    })) ?? []
  };
}
