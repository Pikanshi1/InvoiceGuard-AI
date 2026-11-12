import { Router } from "express";
import { evaluateInvoice } from "../lib/policy";

export const securityRouter = Router();

securityRouter.get("/red-team/scenarios", (_req, res) => {
  const scenarios = [
    {
      id: "duplicate-invoice",
      title: "Duplicate invoice",
      result: evaluateInvoice({ invoiceAmount: 1000, poAmount: 1000, vendorVerified: true, duplicate: true, paymentDestinationChanged: false, approvalLimit: 5000 })
    },
    {
      id: "unverified-vendor",
      title: "Unverified vendor",
      result: evaluateInvoice({ invoiceAmount: 1000, poAmount: 1000, vendorVerified: false, duplicate: false, paymentDestinationChanged: false, approvalLimit: 5000 })
    },
    {
      id: "payment-destination-change",
      title: "Changed payment destination",
      result: evaluateInvoice({ invoiceAmount: 1000, poAmount: 1000, vendorVerified: true, duplicate: false, paymentDestinationChanged: true, approvalLimit: 5000 })
    },
    {
      id: "over-limit-invoice",
      title: "Invoice over approval limit",
      result: evaluateInvoice({ invoiceAmount: 10000, poAmount: 10000, vendorVerified: true, duplicate: false, paymentDestinationChanged: false, approvalLimit: 5000 })
    }
  ];
  res.json({ generatedAt: new Date().toISOString(), scenarios });
});
