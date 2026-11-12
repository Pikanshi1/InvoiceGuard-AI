import { describe, expect, it } from "vitest";
import { detectSupportedDocumentType, sanitizeDocumentFileName } from "./uploaded-file";

describe("document upload validation", () => {
  it("detects supported PDF, PNG, and JPEG signatures", () => {
    expect(detectSupportedDocumentType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectSupportedDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectSupportedDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBe("image/jpeg");
  });

  it("accepts UTF-8 text but rejects NUL-containing and empty files", () => {
    expect(detectSupportedDocumentType(Buffer.from("invoice 123", "utf8"))).toBe("text/plain");
    expect(detectSupportedDocumentType(Buffer.from([0x61, 0x00, 0x62]))).toBeNull();
    expect(detectSupportedDocumentType(Buffer.alloc(0))).toBeNull();
  });

  it("normalizes filenames to a safe basename and MIME-derived extension", () => {
    expect(sanitizeDocumentFileName("../../invoice\r\n.exe", "application/pdf")).toBe("invoice.pdf");
    expect(sanitizeDocumentFileName("C:\\private\\invoice.jpg", "image/jpeg")).toBe("invoice.jpg");
  });
});
