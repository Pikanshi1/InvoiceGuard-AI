import { describe, expect, it } from "vitest";
import { getInvoiceApprovalBlockReason } from "./invoice-approval";

const eligible = { status: "PENDING", createdById: "creator", evaluatedAt: new Date() };

describe("invoice approval eligibility", () => {
  it("blocks approval before evaluation", () => {
    expect(getInvoiceApprovalBlockReason({ ...eligible, evaluatedAt: null }, "approver")).toBe("NOT_EVALUATED");
  });

  it("blocks records whose creator cannot be established", () => {
    expect(getInvoiceApprovalBlockReason({ ...eligible, createdById: null }, "approver")).toBe("CREATOR_UNKNOWN");
  });

  it("prevents the invoice creator from approving it", () => {
    expect(getInvoiceApprovalBlockReason(eligible, "creator")).toBe("SELF_APPROVAL");
  });

  it.each(["PENDING", "REVIEW"])("allows evaluated %s invoices to proceed through human approval", status => {
    expect(getInvoiceApprovalBlockReason({ ...eligible, status }, "approver")).toBeNull();
  });

  it("blocks invoices that are not in an approvable state", () => {
    expect(getInvoiceApprovalBlockReason({ ...eligible, status: "BLOCKED" }, "approver")).toBe("INVALID_STATUS");
  });
});
