import { describe, expect, it } from "vitest";
import { evaluateInvoice } from "./policy";

describe("evaluateInvoice", () => {
  it("blocks duplicate invoices", () => {
    expect(evaluateInvoice({
      invoiceAmount: 1000, poAmount: 1000, vendorVerified: true,
      duplicate: true, paymentDestinationChanged: false, approvalLimit: 5000
    }).decision).toBe("BLOCK");
  });

  it("requests review when vendor is unverified", () => {
    expect(evaluateInvoice({
      invoiceAmount: 1000, poAmount: 1000, vendorVerified: false,
      duplicate: false, paymentDestinationChanged: false, approvalLimit: 5000
    }).decision).toBe("REVIEW");
  });

  it("approves when deterministic checks pass", () => {
    expect(evaluateInvoice({
      invoiceAmount: 1000, poAmount: 1000, vendorVerified: true,
      duplicate: false, paymentDestinationChanged: false, approvalLimit: 5000
    }).decision).toBe("APPROVE");
  });

  it("blocks an invoice over the hard risk threshold", () => {
    expect(evaluateInvoice({
      invoiceAmount: 12000, poAmount: null, vendorVerified: false,
      duplicate: false, paymentDestinationChanged: true, approvalLimit: 5000
    }).decision).toBe("BLOCK");
  });

  it("reviews incomplete receipt quantities", () => {
    const result = evaluateInvoice({
      invoiceAmount: 1000, poAmount: 1000, vendorVerified: true,
      duplicate: false, paymentDestinationChanged: false,
      receivedQuantity: 5, orderedQuantity: 10, approvalLimit: 5000
    });
    expect(result.decision).toBe("REVIEW");
    expect(result.reasons).toContain("Received quantity is lower than the ordered quantity.");
  });

  it("reviews a purchase order with no goods receipt evidence", () => {
    const result = evaluateInvoice({
      invoiceAmount: 1000, poAmount: 1000, vendorVerified: true,
      duplicate: false, paymentDestinationChanged: false,
      receiptEvidenceMissing: true, approvalLimit: 5000
    });
    expect(result.decision).toBe("REVIEW");
    expect(result.reasons).toContain("No goods receipt is recorded for the purchase order.");
  });

  it("uses configured purchase-order tolerance", () => {
    const result = evaluateInvoice({
      invoiceAmount: 1040, poAmount: 1000, vendorVerified: true,
      duplicate: false, paymentDestinationChanged: false,
      approvalLimit: 5000, poTolerancePercent: 3
    });
    expect(result.decision).toBe("REVIEW");
    expect(result.reasons).toContain("Invoice amount exceeds the purchase-order tolerance of 3%.");
  });
});
