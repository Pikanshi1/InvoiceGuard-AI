import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    purchaseOrder: { findFirst: vi.fn() },
    goodsReceipt: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn()
  },
  recordAuditEvent: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));

import { procurementRouter } from "./procurement";

describe("goods receipt quantity controls", () => {
  let server: Server;
  let baseUrl: string;
  let tx: {
    $queryRaw: ReturnType<typeof vi.fn>;
    goodsReceipt: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.prisma.purchaseOrder.findFirst.mockResolvedValue({ id: "po-1", workspaceId: "workspace-1" });
    mocks.recordAuditEvent.mockResolvedValue({ id: "audit-1" });
    tx = {
      $queryRaw: vi.fn(),
      goodsReceipt: { findMany: vi.fn(), create: vi.fn().mockResolvedValue({ id: "receipt-2" }) }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = "finance-1";
      req.role = "FINANCE";
      next();
    });
    app.use("/api/procurement", procurementRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/procurement`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const submitReceipt = (receivedQty: number, acceptedQty: number) => fetch(`${baseUrl}/receipts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purchaseOrderId: "po-1", reference: "grn-2", orderedQty: 10, receivedQty, acceptedQty })
  });

  it("allows the final partial receipt when cumulative quantities do not exceed the order", async () => {
    tx.goodsReceipt.findMany.mockResolvedValue([{ orderedQty: 10, receivedQty: 8, acceptedQty: 8 }]);

    const response = await submitReceipt(2, 2);

    expect(response.status).toBe(201);
    expect(tx.goodsReceipt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ purchaseOrderId: "po-1", orderedQty: 10 }) }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledOnce();
  });

  it("rejects cumulative receipt quantities that exceed the order", async () => {
    tx.goodsReceipt.findMany.mockResolvedValue([{ orderedQty: 10, receivedQty: 8, acceptedQty: 8 }]);

    const response = await submitReceipt(3, 3);

    expect(response.status).toBe(400);
    expect(tx.goodsReceipt.create).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("fails closed when existing receipt rows disagree about the PO quantity", async () => {
    tx.goodsReceipt.findMany.mockResolvedValue([
      { orderedQty: 10, receivedQty: 4, acceptedQty: 4 },
      { orderedQty: 12, receivedQty: 2, acceptedQty: 2 }
    ]);

    const response = await submitReceipt(1, 1);

    expect(response.status).toBe(409);
    expect(tx.goodsReceipt.create).not.toHaveBeenCalled();
  });
});
