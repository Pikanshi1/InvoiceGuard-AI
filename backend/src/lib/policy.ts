export type InvoiceCheckInput = {
  invoiceAmount: number;
  poAmount?: number | null;
  vendorVerified: boolean;
  duplicate: boolean;
  paymentDestinationChanged: boolean;
  receivedQuantity?: number;
  orderedQuantity?: number;
  receiptEvidenceMissing?: boolean;
  approvalLimit: number;
  poTolerancePercent?: number;
};

export type PolicyDecision = {
  decision: "APPROVE" | "REVIEW" | "BLOCK";
  score: number;
  reasons: string[];
};

export const DEFAULT_APPROVAL_LIMIT = 100000;
export const DEFAULT_PO_TOLERANCE_PERCENT = 5;

export function evaluateInvoice(input: InvoiceCheckInput): PolicyDecision {
  const reasons: string[] = [];
  let score = 0;

  if (input.duplicate) {
    reasons.push("Possible duplicate invoice detected.");
    score += 100;
  }
  if (!input.vendorVerified) {
    reasons.push("Vendor is not verified in this workspace.");
    score += 45;
  }
  if (input.paymentDestinationChanged) {
    reasons.push("Vendor payment destination has changed and needs independent verification.");
    score += 60;
  }
  if (input.poAmount == null) {
    reasons.push("No purchase order is linked to this invoice.");
    score += 30;
  } else if (input.invoiceAmount > input.poAmount * (1 + (input.poTolerancePercent ?? DEFAULT_PO_TOLERANCE_PERCENT) / 100)) {
    reasons.push(`Invoice amount exceeds the purchase-order tolerance of ${input.poTolerancePercent ?? DEFAULT_PO_TOLERANCE_PERCENT}%.`);
    score += 40;
  }
  if (input.receiptEvidenceMissing) {
    reasons.push("No goods receipt is recorded for the purchase order.");
    score += 25;
  } else if (input.receivedQuantity != null && input.orderedQuantity != null &&
      input.receivedQuantity !== input.orderedQuantity) {
    reasons.push(input.receivedQuantity < input.orderedQuantity
      ? "Received quantity is lower than the ordered quantity."
      : "Accepted receipt quantity exceeds the ordered quantity.");
    score += 25;
  }
  if (input.invoiceAmount > input.approvalLimit) {
    reasons.push("Invoice exceeds the configured approval limit.");
    score += 20;
  }

  if (input.duplicate) return { decision: "BLOCK", score: Math.min(score, 100), reasons };
  if (score >= 60) return { decision: "BLOCK", score: Math.min(score, 100), reasons };
  if (score > 0) return { decision: "REVIEW", score: Math.min(score, 100), reasons };
  return { decision: "APPROVE", score: 0, reasons: ["All configured deterministic checks passed."] };
}
