import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { requireRole } from "../middleware/workspace";
import { createAuthenticatedRateLimit } from "../middleware/rate-limit";

export const integrationsRouter = Router();
const aiExplanationRateLimit = createAuthenticatedRateLimit(10);

function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_BASE_URL);
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3) {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      if (![429, 500, 502, 503, 504].includes(response.status)) return response;
      lastResponse = response;
      if (attempt === attempts - 1) break;
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : 400 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch {
      if (attempt === attempts - 1) throw new Error("External service request failed.");
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  if (lastResponse) return lastResponse;
  throw new Error("External service request failed.");
}

async function paypalAccessToken() {
  if (!paypalConfigured()) throw new Error("PayPal is not configured.");
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetchWithRetry(`${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error("PayPal authentication failed.");
  const result = await response.json() as { access_token?: string };
  if (!result.access_token) throw new Error("PayPal returned no access token.");
  return result.access_token;
}

integrationsRouter.get("/status", (_req, res) => {
  res.json({
    paypal: { configured: paypalConfigured(), mode: !paypalConfigured() ? "not-configured" : (process.env.PAYPAL_BASE_URL ?? "").includes("sandbox") ? "sandbox" : "production", status: paypalConfigured() ? "credentials-configured-not-connection-tested" : "not-configured" },
    elasticsearch: { configured: Boolean(process.env.ELASTIC_URL), mode: process.env.ELASTIC_URL ? "optional" : "postgresql-fallback", status: process.env.ELASTIC_URL ? "endpoint-configured-not-health-checked" : "not-configured" },
    ai: { configured: (process.env.AI_PROVIDER ?? "gemini").toLowerCase() === "gemini" && Boolean(process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL), mode: "gemini" },
    database: { configured: Boolean(process.env.DATABASE_URL), provider: "postgresql", status: process.env.DATABASE_URL ? "connection-not-tested" : "not-configured" },
    email: { configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_SENDER_EMAIL), provider: "gmail-oauth2", status: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_SENDER_EMAIL ? "credentials-configured-not-delivery-tested" : "not-configured" },
    notifications: { configured: true, mode: "database-only" }
  });
});

integrationsRouter.post("/paypal/orders", requireRole("OWNER", "ADMIN", "FINANCE"), async (req, res, next) => {
  try {
    if (!paypalConfigured()) return res.status(503).json({ error: "PayPal is not configured." });
    const data = z.object({ invoiceId: z.string(), currency: z.string().length(3).default("USD") }).parse(req.body);
    const invoice = await prisma.invoice.findFirst({ where: { id: data.invoiceId, workspaceId: req.workspaceId } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found in this workspace." });
    const idempotencyKey = req.header("x-idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 108 || /[\r\n]/.test(idempotencyKey)) return res.status(400).json({ error: "A valid x-idempotency-key header is required (maximum 108 characters)." });
    const existingPayment = await prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existingPayment) {
      if (existingPayment.workspaceId !== req.workspaceId || existingPayment.invoiceId !== invoice.id) return res.status(409).json({ error: "Idempotency key has already been used for another payment." });
      if (existingPayment.currency.toUpperCase() !== data.currency.toUpperCase()) return res.status(409).json({ error: "Payment currency does not match the original idempotent request." });
      if (existingPayment.status !== "CREATED" || existingPayment.providerRef) return res.status(200).json({ payment: existingPayment, reused: true });
    }
    if (invoice.status !== "APPROVED" && !existingPayment) return res.status(409).json({ error: "Invoice must be approved before payment." });
    if (data.currency.toUpperCase() !== invoice.currency.toUpperCase()) return res.status(409).json({ error: "Payment currency must match the invoice currency." });
    let reservation: { payment: { id: string; workspaceId: string; invoiceId: string; providerRef: string | null; amount: unknown; currency: string; status: string }; isRetry: boolean };
    try {
      reservation = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"payment:" + invoice.id})::bigint)`;
        const keyed = await tx.payment.findUnique({ where: { idempotencyKey } });
        const currentInvoice = await tx.invoice.findFirst({ where: { id: invoice.id, workspaceId: req.workspaceId, status: "APPROVED" } });
        if (!currentInvoice) throw Object.assign(new Error("Invoice approval changed before a payment could be created."), { code: "PAYMENT_INVOICE_NOT_APPROVED" });
        if (keyed) {
          if (keyed.workspaceId !== req.workspaceId || keyed.invoiceId !== invoice.id) throw Object.assign(new Error("Idempotency key has already been used for another payment."), { code: "PAYMENT_IDEMPOTENCY_CONFLICT" });
          if (keyed.currency.toUpperCase() !== data.currency.toUpperCase()) throw Object.assign(new Error("Payment currency does not match the original idempotent request."), { code: "PAYMENT_IDEMPOTENCY_CONFLICT" });
          return { payment: keyed, isRetry: true };
        }
        const activePayment = await tx.payment.findFirst({
          where: { workspaceId: req.workspaceId, invoiceId: invoice.id, status: { in: ["CREATED", "PENDING"] } }
        });
        if (activePayment) throw Object.assign(new Error("This invoice already has a payment in progress."), { code: "PAYMENT_ALREADY_ACTIVE" });
        const payment = await tx.payment.create({ data: { workspaceId: req.workspaceId!, invoiceId: invoice.id, amount: currentInvoice.amount, currency: data.currency.toUpperCase(), idempotencyKey, status: "CREATED" } });
        return { payment, isRetry: false };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = String((error as { code?: string }).code);
        if (code === "PAYMENT_INVOICE_NOT_APPROVED") return res.status(409).json({ error: "Invoice must remain approved before payment." });
        if (code === "PAYMENT_IDEMPOTENCY_CONFLICT") return res.status(409).json({ error: "Idempotency key has already been used for another payment." });
        if (code === "PAYMENT_ALREADY_ACTIVE") return res.status(409).json({ error: "This invoice already has a payment in progress." });
        if (code === "P2034" || code === "P2002") return res.status(409).json({ error: "Payment state changed. Retry with the same idempotency key." });
      }
      throw error;
    }
    if (reservation.payment.status !== "CREATED" || reservation.payment.providerRef) {
      return res.status(200).json({ payment: reservation.payment, reused: true });
    }

    const token = await paypalAccessToken();
    const orderResponse = await fetchWithRetry(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": idempotencyKey },
      body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: data.currency.toUpperCase(), value: Number(reservation.payment.amount).toFixed(2) } }] })
    });
    const order = await orderResponse.json() as { id?: string };
    if (!orderResponse.ok || !order.id) {
      await prisma.payment.updateMany({ where: { id: reservation.payment.id, status: "CREATED" }, data: { status: "FAILED" } });
      return res.status(502).json({ error: "PayPal order creation failed." });
    }
    const claimed = await prisma.payment.updateMany({ where: { id: reservation.payment.id, status: "CREATED" }, data: { providerRef: order.id, status: "PENDING" } });
    let payment = claimed.count === 1 ? await prisma.payment.findUniqueOrThrow({ where: { id: reservation.payment.id } }) : null;
    if (!payment) {
      payment = await prisma.payment.findUnique({ where: { idempotencyKey } });
      if (!payment || payment.status !== "PENDING" || payment.providerRef !== order.id) return res.status(409).json({ error: "Payment state changed. Retry with the same idempotency key." });
    }
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Payment", entityId: payment.id, action: "PAYPAL_ORDER_CREATED", metadata: { paypalOrderId: order.id } });
    res.status(reservation.isRetry ? 200 : 201).json({ payment, order, ...(reservation.isRetry ? { reused: true } : {}) });
  } catch (error) { next(error); }
});

integrationsRouter.get("/paypal/orders/:orderId/approval", requireRole("OWNER", "ADMIN", "FINANCE"), async (req, res, next) => {
  try {
    if (!paypalConfigured()) return res.status(503).json({ error: "PayPal is not configured." });
    const orderId = String(req.params.orderId);
    const payment = await prisma.payment.findFirst({
      where: { providerRef: orderId, workspaceId: req.workspaceId },
      include: { invoice: true }
    });
    if (!payment) return res.status(404).json({ error: "Payment order not found in this workspace." });
    if (payment.status !== "PENDING" || payment.invoice.status !== "APPROVED") {
      return res.status(409).json({ error: "Only pending payments for currently approved invoices can be opened for approval." });
    }

    const token = await paypalAccessToken();
    const response = await fetchWithRetry(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    if (!response.ok) return res.status(502).json({ error: "PayPal order details are temporarily unavailable." });
    const order = await response.json() as {
      id?: string;
      purchase_units?: Array<{ amount?: { currency_code?: string; value?: string } }>;
      links?: Array<{ rel?: string; href?: string }>;
    };
    const orderAmount = order.purchase_units?.[0]?.amount;
    if (order.id !== payment.providerRef ||
        orderAmount?.currency_code?.toUpperCase() !== payment.currency.toUpperCase() ||
        Number(orderAmount?.value) !== Number(payment.amount)) {
      return res.status(502).json({ error: "PayPal order details do not match the reserved payment." });
    }
    const approvalLink = order.links?.find(link => link.rel === "approve" || link.rel === "payer-action")?.href;
    let approvalUrl: URL;
    try { approvalUrl = new URL(approvalLink ?? ""); } catch { return res.status(502).json({ error: "PayPal did not return a valid approval link." }); }
    if (approvalUrl.protocol !== "https:" || !(approvalUrl.hostname === "paypal.com" || approvalUrl.hostname.endsWith(".paypal.com"))) {
      return res.status(502).json({ error: "PayPal returned an untrusted approval link." });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ approvalUrl: approvalUrl.toString() });
  } catch (error) { next(error); }
});

integrationsRouter.post("/paypal/orders/:orderId/capture", requireRole("OWNER", "ADMIN", "FINANCE"), async (req, res, next) => {
  try {
    if (!paypalConfigured()) return res.status(503).json({ error: "PayPal is not configured." });
    const payment = await prisma.payment.findFirst({ where: { providerRef: String(req.params.orderId), workspaceId: req.workspaceId }, include: { invoice: true } });
    if (!payment) return res.status(404).json({ error: "Payment order not found in this workspace." });
    if (payment.status === "COMPLETED") return res.json({ payment, reused: true });
    if (payment.invoice.status !== "APPROVED") return res.status(409).json({ error: "Invoice approval is no longer current; capture is blocked." });
    const token = await paypalAccessToken();
    const response = await fetchWithRetry(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(String(req.params.orderId))}/capture`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": payment.id } });
    const result = await response.json() as {
      status?: string;
      purchase_units?: Array<{ payments?: { captures?: Array<{ status?: string; amount?: { value?: string; currency_code?: string } }> } }>;
    };
    if (!response.ok) return res.status(502).json({ error: "PayPal capture failed." });
    const capture = result.purchase_units?.flatMap(unit => unit.payments?.captures ?? []).find(item => item.status === "COMPLETED");
    const confirmed = result.status === "COMPLETED" && capture?.status === "COMPLETED" &&
      capture.amount?.currency_code?.toUpperCase() === payment.currency.toUpperCase() &&
      Number(capture.amount?.value) === Number(payment.amount);
    const updated = confirmed
      ? await prisma.$transaction(async tx => {
          const changed = await tx.invoice.updateMany({ where: { id: payment.invoiceId, workspaceId: payment.workspaceId, status: { in: ["APPROVED", "REVIEW"] } }, data: { status: "PAID" } });
          if (changed.count !== 1) throw new Error("Paid invoice could not be reconciled.");
          const completed = await tx.payment.updateMany({ where: { id: payment.id, workspaceId: payment.workspaceId, status: "PENDING" }, data: { status: "COMPLETED" } });
          if (completed.count !== 1) throw new Error("Payment is no longer pending.");
          return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        })
      : await prisma.payment.update({ where: { id: payment.id }, data: { status: "PENDING" } });
    await recordAuditEvent({ workspaceId: req.workspaceId!, actorId: req.userId, entityType: "Payment", entityId: updated.id, action: "PAYPAL_CAPTURED", metadata: { orderId: req.params.orderId, status: result.status, confirmed } });
    res.json({ payment: updated, confirmed });
  } catch (error) { next(error); }
});

integrationsRouter.post("/paypal/webhook", async (req, res, next) => {
  try {
    if (!paypalConfigured() || !process.env.PAYPAL_WEBHOOK_ID) return res.status(503).json({ error: "PayPal webhook verification is not configured." });
    const token = await paypalAccessToken();
    const verificationResponse = await fetchWithRetry(`${process.env.PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: req.header("paypal-auth-algo"),
        cert_url: req.header("paypal-cert-url"),
        transmission_id: req.header("paypal-transmission-id"),
        transmission_sig: req.header("paypal-transmission-sig"),
        transmission_time: req.header("paypal-transmission-time"),
        webhook_id: process.env.PAYPAL_WEBHOOK_ID,
        webhook_event: req.body
      })
    });
    const verification = await verificationResponse.json() as { verification_status?: string };
    if (!verificationResponse.ok || verification.verification_status !== "SUCCESS") return res.status(400).json({ error: "Invalid PayPal webhook signature." });
    const event = req.body as { id?: string; event_type?: string; resource?: { id?: string; status?: string; amount?: { value?: string; currency_code?: string }; supplementary_data?: { related_ids?: { order_id?: string } } } };
    if (!event.id) return res.status(400).json({ error: "PayPal webhook event ID is missing." });
    const providerRef = event.resource?.supplementary_data?.related_ids?.order_id ?? event.resource?.id;
    const payment = providerRef ? await prisma.payment.findFirst({ where: { providerRef } }) : null;
    const workspaceId = payment?.workspaceId ?? null;
    const verifiedCapture = payment &&
      event.event_type === "PAYMENT.CAPTURE.COMPLETED" &&
      event.resource?.status === "COMPLETED" &&
      event.resource.amount?.currency_code?.toUpperCase() === payment.currency.toUpperCase() &&
      Number(event.resource.amount?.value) === Number(payment.amount);
    const inserted = await prisma.$transaction(async tx => {
      const eventRows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "PayPalWebhookEvent" ("id", "workspaceId", "eventId", "eventType")
        VALUES (${crypto.randomUUID()}, ${workspaceId}, ${event.id}, ${event.event_type ?? "UNKNOWN"})
        ON CONFLICT ("eventId") DO NOTHING
        RETURNING "id"
      `;
      if (eventRows.length === 0) return false;
      if (verifiedCapture && payment) {
        const changed = await tx.invoice.updateMany({ where: { id: payment.invoiceId, workspaceId: payment.workspaceId, status: { in: ["APPROVED", "REVIEW"] } }, data: { status: "PAID" } });
        if (changed.count !== 1) throw new Error("Paid invoice could not be reconciled from the PayPal webhook.");
        const completed = await tx.payment.updateMany({ where: { id: payment.id, workspaceId: payment.workspaceId, status: "PENDING" }, data: { status: "COMPLETED" } });
        if (completed.count !== 1) throw new Error("Payment is no longer pending.");
      }
      return true;
    });
    if (!inserted) return res.status(202).json({ received: true, duplicate: true });
    res.status(202).json({ received: true });
  } catch (error) { next(error); }
});

integrationsRouter.post("/ai/explain", aiExplanationRateLimit, async (req, res) => {
  try {
    if ((process.env.AI_PROVIDER ?? "gemini").toLowerCase() !== "gemini" || !process.env.AI_API_KEY || !process.env.AI_BASE_URL || !process.env.AI_MODEL) return res.status(503).json({ error: "Gemini AI is not configured." });
    const data = z.object({ question: z.string().min(1).max(4000), context: z.string().max(12000) }).parse(req.body);
    const response = await fetchWithRetry(`${process.env.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.AI_MODEL, temperature: 0, messages: [
        { role: "system", content: "Explain evidence and policy outcomes. Never authorize payment or change policy." },
        { role: "user", content: `${data.question}

Evidence:
${data.context}` }
      ] })
    });
    if (!response.ok) return res.status([429, 500, 502, 503, 504].includes(response.status) ? 503 : 502).json({ error: "AI service is temporarily unavailable. Please try again later." });
    let result: { choices?: { message?: { content?: string } }[] };
    try { result = await response.json() as typeof result; } catch { return res.status(502).json({ error: "AI service returned an invalid response. Please try again later." }); }
    const explanation = result.choices?.[0]?.message?.content;
    if (typeof explanation !== "string" || !explanation.trim()) return res.status(502).json({ error: "AI service returned an invalid response. Please try again later." });
    res.json({ explanation });
  } catch {
    res.status(503).json({ error: "AI service is temporarily unavailable. Please try again later." });
  }
});

integrationsRouter.post("/elasticsearch/search", async (req, res, next) => {
  try {
    const query = z.object({ query: z.string().trim().min(2).max(100) }).parse(req.body).query;
    if (process.env.ELASTIC_URL) {
      try {
        const response = await fetchWithRetry(`${process.env.ELASTIC_URL.replace(/\/$/, "")}/invoiceguard/_search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(process.env.ELASTIC_API_KEY ? { Authorization: `ApiKey ${process.env.ELASTIC_API_KEY}` } : {}) },
          body: JSON.stringify({
            query: {
              bool: {
                must: [{ multi_match: { query, fields: ["invoiceNumber", "vendor", "text"] } }],
                filter: [{ term: { workspaceId: req.workspaceId } }]
              }
            }
          })
        });
        if (response.ok) return res.json({ provider: "elasticsearch", results: await response.json() });
      } catch {
        // PostgreSQL remains the source of truth and fallback search provider.
      }
    }
    const workspaceId = req.workspaceId!;
    const [vendors, invoices, requests, orders] = await Promise.all([
      prisma.vendor.findMany({ where: { workspaceId, name: { contains: query, mode: "insensitive" } }, select: { id: true, name: true, email: true }, take: 20 }),
      prisma.invoice.findMany({ where: { workspaceId, invoiceNumber: { contains: query, mode: "insensitive" } }, take: 20 }),
      prisma.purchaseRequest.findMany({ where: { workspaceId, title: { contains: query, mode: "insensitive" } }, take: 20 }),
      prisma.purchaseOrder.findMany({ where: { workspaceId, poNumber: { contains: query, mode: "insensitive" } }, take: 20 })
    ]);
    res.json({ provider: "postgresql", results: { vendors, invoices, requests, orders } });
  } catch (error) { next(error); }
});
