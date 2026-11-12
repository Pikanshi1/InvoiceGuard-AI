export type InvoiceApprovalState = {
  status: string;
  createdById: string | null;
  evaluatedAt: Date | null;
};

export type ApprovalBlockReason = "NOT_EVALUATED" | "CREATOR_UNKNOWN" | "SELF_APPROVAL" | "INVALID_STATUS";

export function getInvoiceApprovalBlockReason(
  invoice: InvoiceApprovalState,
  approverId: string
): ApprovalBlockReason | null {
  if (!invoice.evaluatedAt) return "NOT_EVALUATED";
  if (!invoice.createdById) return "CREATOR_UNKNOWN";
  if (invoice.createdById === approverId) return "SELF_APPROVAL";
  if (invoice.status !== "PENDING" && invoice.status !== "REVIEW") return "INVALID_STATUS";
  return null;
}
