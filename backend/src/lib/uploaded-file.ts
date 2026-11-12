import path from "node:path";

export type SupportedDocumentType = "application/pdf" | "text/plain" | "image/png" | "image/jpeg";

export function detectSupportedDocumentType(buffer: Buffer): SupportedDocumentType | null {
  if (buffer.length === 0) return null;
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (!text.includes("\u0000")) return "text/plain";
  } catch {
    // Invalid UTF-8 and binary files are not accepted as plain text.
  }
  return null;
}

const extensionByType: Record<SupportedDocumentType, string> = {
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "image/png": ".png",
  "image/jpeg": ".jpg"
};

export function sanitizeDocumentFileName(originalName: string, mimeType: SupportedDocumentType) {
  const basename = path.basename(originalName.replace(/\\/g, "/"));
  const stem = path.basename(basename, path.extname(basename))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 240)
    .trim();
  return `${stem || "document"}${extensionByType[mimeType]}`;
}
