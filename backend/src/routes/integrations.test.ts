import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    invoice: { findFirst: vi.fn() },
    payment: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn()
  },
  recordAuditEvent: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));

import { integrationsRouter } from "./integrations";

describe("PayPal payment order creation", () => {
  let server: Server;
  let baseUrl: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let clientFetch: typeof fetch;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv("PAYPAL_CLIENT_ID", "test-client");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-secret");
    vi.stubEnv("PAYPAL_BASE_URL", "https://paypal.test");
    clientFetch = globalThis.fetch.bind(globalThis);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.prisma.invoice.findFirst.mockResolvedValue({ id: "invoice-1", workspaceId: "workspace-1", status: "APPROVED", amount: 250, currency: "USD" });
    mocks.recordAuditEvent.mockResolvedValue({ id: "audit-1" });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = "finance-1";
      req.role = "FINANCE";
      next();
    });
    app.use("/api/integrations", integrationsRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/integrations`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("rejects another idempotency key when the invoice already has a reserved payment", async () => {
    const tx = {
      $queryRaw: vi.fn(),
      invoice: { findFirst: vi.fn().mockResolvedValue({ id: "invoice-1", amount: 250, status: "APPROVED" }) },
      payment: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({ id: "payment-existing", status: "CREATED" }),
        create: vi.fn()
      }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await clientFetch(`${baseUrl}/paypal/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "request-new" },
      body: JSON.stringify({ invoiceId: "invoice-1", currency: "USD" })
    });

    expect(response.status).toBe(409);
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses a pending payment for the same idempotency key without another provider call", async () => {
    const existingPayment = { id: "payment-1", workspaceId: "workspace-1", invoiceId: "invoice-1", amount: 250, currency: "USD", status: "PENDING", providerRef: "order-1" };
    mocks.prisma.invoice.findFirst.mockResolvedValue({ id: "invoice-1", workspaceId: "workspace-1", status: "PAID", amount: 250, currency: "USD" });
    mocks.prisma.payment.findUnique.mockResolvedValue(existingPayment);

    const response = await clientFetch(`${baseUrl}/paypal/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "request-1" },
      body: JSON.stringify({ invoiceId: "invoice-1", currency: "USD" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ payment: { id: "payment-1" }, reused: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not retry an unsubmitted reserved payment after invoice approval is revoked", async () => {
    const reservedPayment = { id: "payment-1", workspaceId: "workspace-1", invoiceId: "invoice-1", amount: 250, currency: "USD", status: "CREATED", providerRef: null };
    mocks.prisma.invoice.findFirst.mockResolvedValue({ id: "invoice-1", workspaceId: "workspace-1", status: "REVIEW", amount: 250, currency: "USD" });
    mocks.prisma.payment.findUnique.mockResolvedValue(reservedPayment);
    const tx = {
      $queryRaw: vi.fn(),
      invoice: { findFirst: vi.fn().mockResolvedValue(null) },
      payment: { findUnique: vi.fn().mockResolvedValue(reservedPayment), findFirst: vi.fn(), create: vi.fn() }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await clientFetch(`${baseUrl}/paypal/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "request-1" },
      body: JSON.stringify({ invoiceId: "invoice-1", currency: "USD" })
    });

    expect(response.status).toBe(409);
    expect(tx.invoice.findFirst).toHaveBeenCalledWith({ where: { id: "invoice-1", workspaceId: "workspace-1", status: "APPROVED" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reserves a payment before calling PayPal and stores the provider order", async () => {
    const reservedPayment = { id: "payment-1", workspaceId: "workspace-1", invoiceId: "invoice-1", amount: 250, currency: "USD", status: "CREATED", providerRef: null };
    const pendingPayment = { ...reservedPayment, status: "PENDING", providerRef: "order-1" };
    const tx = {
      $queryRaw: vi.fn(),
      invoice: { findFirst: vi.fn().mockResolvedValue({ id: "invoice-1", amount: 250, status: "APPROVED" }) },
      payment: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(reservedPayment)
      }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    mocks.prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.payment.findUniqueOrThrow.mockResolvedValue(pendingPayment);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "order-1" }), { status: 201 }));

    const response = await clientFetch(`${baseUrl}/paypal/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "request-1" },
      body: JSON.stringify({ invoiceId: "invoice-1", currency: "USD" })
    });

    expect(response.status).toBe(201);
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CREATED" }) }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers["PayPal-Request-Id"]).toBe("request-1");
    expect(mocks.prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "payment-1", status: "CREATED" },
      data: { providerRef: "order-1", status: "PENDING" }
    }));
  });

  it("blocks capture when the invoice is no longer approved", async () => {
    mocks.prisma.payment.findFirst.mockResolvedValue({
      id: "payment-1", workspaceId: "workspace-1", invoiceId: "invoice-1", providerRef: "order-1", status: "PENDING",
      invoice: { status: "REVIEW" }
    });

    const response = await clientFetch(`${baseUrl}/paypal/orders/order-1/capture`, { method: "POST" });

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a validated PayPal approval URL only for the active workspace payment", async () => {
    mocks.prisma.payment.findFirst.mockResolvedValue({
      id: "payment-1", workspaceId: "workspace-1", invoiceId: "invoice-1", providerRef: "order-1",
      amount: 250, currency: "USD", status: "PENDING", invoice: { status: "APPROVED" }
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "order-1",
        purchase_units: [{ amount: { value: "250.00", currency_code: "USD" } }],
        links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=order-1" }]
      }), { status: 200 }));

    const response = await clientFetch(`${baseUrl}/paypal/orders/order-1/approval`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order-1" });
    expect(mocks.prisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { providerRef: "order-1", workspaceId: "workspace-1" }
    }));
  });

  it("rejects an untrusted approval URL returned by PayPal", async () => {
    mocks.prisma.payment.findFirst.mockResolvedValue({
      id: "payment-1", workspaceId: "workspace-1", invoiceId: "invoice-1", providerRef: "order-1",
      amount: 250, currency: "USD", status: "PENDING", invoice: { status: "APPROVED" }
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "order-1",
        purchase_units: [{ amount: { value: "250.00", currency_code: "USD" } }],
        links: [{ rel: "approve", href: "https://evil.example/checkout" }]
      }), { status: 200 }));

    const response = await clientFetch(`${baseUrl}/paypal/orders/order-1/approval`);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "PayPal returned an untrusted approval link." });
  });

  it("marks an approved invoice paid only after matching PayPal capture evidence", async () => {
    const payment = {
      id: "payment-1", workspaceId: "workspace-1", invoiceId: "invoice-1", providerRef: "order-1",
      amount: 250, currency: "USD", status: "PENDING", invoice: { status: "APPROVED" }
    };
    const tx = {
      invoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      payment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...payment, status: "COMPLETED" })
      }
    };
    mocks.prisma.payment.findFirst.mockResolvedValue(payment);
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ status: "COMPLETED", amount: { value: "250.00", currency_code: "USD" } }] } }]
      }), { status: 201 }));

    const response = await clientFetch(`${baseUrl}/paypal/orders/order-1/capture`, { method: "POST" });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.confirmed).toBe(true);
    expect(tx.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "invoice-1", workspaceId: "workspace-1", status: { in: ["APPROVED", "REVIEW"] } }, data: { status: "PAID" }
    }));
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "payment-1", workspaceId: "workspace-1", status: "PENDING" }, data: { status: "COMPLETED" }
    }));
  });

  it("limits repeated AI explanation requests per authenticated user", async () => {
    const responses: Response[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      responses.push(await clientFetch(`${baseUrl}/ai/explain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Explain this policy decision.", context: "Invoice total matched the policy." })
      }));
    }

    expect(responses.slice(0, 10).every(response => response.status !== 429)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(await responses[10].json()).toEqual({ error: "Too many requests. Please try again later." });
  });
});
