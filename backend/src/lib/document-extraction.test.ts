import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractDocumentText, validateInvoiceExtraction } from "./document-extraction";

const digitalPdf = "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA2MTIgNzkyIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYxMTEyMTcxNTM3KzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYxMTEyMTcxNTM3KzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxODQKPj4Kc3RyZWFtCkdhcnAjXWFEVkEmLVVvVDpHSltRYG5NJV1VZjA1cis9WU5EKzYqTUtwUDduTGE3aDgnKDxSK2MvR2giYmAxX0MhIzF0WTJITklkOipnRVFfcF0vRS1nc2JHLlBKbWczXzVzcFEyZm9DTDBQPk1ZXzZXJHImMlhXIV8yQkMzOV5ua0VgQzFvQVhtb1NnJC9YdTZoPmI/NzBnVHRtWDBGTjdmV2JRVk9pRUdeSUplW2Y/NFpvaSpXfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMDkyIDAwMDAwIG4gCjAwMDAwMDAxOTkgMDAwMDAgbiAKMDAwMDAwMDM5MiAwMDAwMCBuIAowMDAwMDAwNDYwIDAwMDAwIG4gCjAwMDAwMDA3MjEgMDAwMDAgbiAKMDAwMDAwMDc4MCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzwyMWQ4MzlkYzZjMTI3ZTk3Zjk5YTM2MmFiNTAzY2UzYT48MjFkODM5ZGM2YzEyN2U5N2Y5OWEzNjJhYjUwM2NlM2E+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDUgMCBSCi9Sb290IDQgMCBSCi9TaXplIDgKPj4Kc3RhcnR4cmVmCjEwNTQKJSVFT0YK";

const ocrPng = "iVBORw0KGgoAAAANSUhEUgAAAaQAAABuAQAAAABAM1r+AAABvklEQVR42u2WsW7UQBCGP99ZcAXKbgkSwn4DrqTi/CAUkXiBlIeE4g3VlfcCSBQ8RopLLtJR8ghLQkHHWkrhQ9YORa5IOWuJUGSnsNx8mn/+mbGnENKjmzAmMvVIqE9w5ooG9u6iUWIysIhUGJHQYkQTYcKA/0OgBzg8FQr709AvXPURblk4rcIgJsjvaity1cpWq7Bj2WGpYQa1VuGE5mD/JsF5z+Dv3tcJVEldAh5q8ImzcYUAZRr1Y0Vs4FtiLgsOXCIVGEBsGlVx9gGiul8DfgCWSLke1DN/I7sbkWorARNEO1GRTeQwS526y4aVIRAxw8m1fpdbaL5g71qtraun6jFVEBlaptq6So6fYJmlfW2mzhXuWD0WABT5r5epTGUqU5n6z5RYLulquGSvPRyQYGIh3ojQeqO+HADwPcLG92qFhWPO7pz4kq1TU0cUG2Y1vPfP3j2Q8wPBRSV172R1dm3Tcr35maTwkOvF6zCiLmvHuPH91xhqdz6GWr3i39d1v19rwlEqVWJPJmkKQxhT1/J6z+f69qt+lznFuGkfWWyepu1yU1LQ1LM0D+fP4eLtfp6v5UxlKlOZSoq/TRGBCdv8t20AAAAASUVORK5CYII=";

describe("document text extraction", () => {
  it("extracts selectable text from digital PDF invoices", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "invoiceguard-test-"));
    const file = path.join(directory, "digital.pdf");
    try {
      await fs.writeFile(file, Buffer.from(digitalPdf, "base64"));
      const result = await extractDocumentText(file, "application/pdf");
      expect(result.method).toBe("pdf-text");
      expect(result.text).toContain("TEST-001");
      expect(result.text).toContain("118.00");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("recognizes text in supported invoice images with Tesseract", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "invoiceguard-test-"));
    const file = path.join(directory, "invoice.png");
    try {
      await fs.writeFile(file, Buffer.from(ocrPng, "base64"));
      const result = await extractDocumentText(file, "image/png");
      expect(result.method).toBe("image-ocr");
      expect(result.text).toContain("OCR-42");
      expect(result.text).toContain("118.00");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("invoice extraction validation", () => {
  it("normalizes currency and monetary values without inventing missing fields", () => {
    expect(validateInvoiceExtraction({
      invoiceNumber: "INV-42",
      vendorName: "Example Supplies",
      currency: "inr",
      subtotal: "100.00",
      taxAmount: 18,
      totalAmount: 118,
      lineItems: [{ description: "Paper", quantity: 2, unitPrice: 50, amount: 100 }]
    })).toMatchObject({
      invoiceNumber: "INV-42",
      currency: "INR",
      subtotal: 100,
      taxAmount: 18,
      totalAmount: 118,
      lineItems: [{ description: "Paper", quantity: 2, unitPrice: 50, amount: 100 }]
    });
  });

  it("rejects malformed currency and unexpected fields", () => {
    expect(() => validateInvoiceExtraction({ invoiceNumber: "INV-1", currency: "US", fabricatedApproval: true })).toThrow();
  });

  it("rejects inconsistent subtotal, tax, and total", () => {
    expect(() => validateInvoiceExtraction({ subtotal: 100, taxAmount: 18, totalAmount: 130 })).toThrow(/do not match/);
  });

  it("rejects invalid dates", () => {
    expect(() => validateInvoiceExtraction({ issueDate: "not-a-date" })).toThrow(/date is invalid/);
  });

  it("does not require or fill in fields absent from the source", () => {
    const result = validateInvoiceExtraction({ invoiceNumber: "INV-EMPTY" });
    expect(result.invoiceNumber).toBe("INV-EMPTY");
    expect(result.totalAmount).toBeNull();
    expect(result.vendorName).toBeUndefined();
  });
});
