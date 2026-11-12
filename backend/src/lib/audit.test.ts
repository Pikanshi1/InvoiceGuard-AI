import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    auditEvent: { findFirst: vi.fn(), create: vi.fn() }
  },
  prisma: { $transaction: vi.fn() }
}));

vi.mock("./prisma", () => ({ prisma: mocks.prisma }));

import { hashAuditPayload, recordAuditEvent } from "./audit";

describe("audit event chain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof mocks.tx) => unknown) => callback(mocks.tx));
    mocks.tx.auditEvent.findFirst.mockResolvedValue(null);
    mocks.tx.auditEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  });

  it("hashes canonical JSON independently of object key insertion order", () => {
    expect(hashAuditPayload({ metadata: { vendor: "Acme", nested: { b: 2, a: 1 } }, action: "UPDATED" }))
      .toBe(hashAuditPayload({ action: "UPDATED", metadata: { nested: { a: 1, b: 2 }, vendor: "Acme" } }));
  });

  it("serializes chain writes and hashes the exact persisted timestamp and prior hash", async () => {
    const previousDate = new Date(Date.now() + 10_000);
    mocks.tx.auditEvent.findFirst.mockResolvedValue({ createdAt: previousDate, eventHash: "previous-hash" });
    const result = await recordAuditEvent({
      workspaceId: "workspace-1", actorId: "user-1", entityType: "Invoice", entityId: "invoice-1", action: "EVALUATED",
      metadata: { score: 25, decision: "REVIEW" }
    });

    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
    const persisted = mocks.tx.auditEvent.create.mock.calls[0][0].data as Record<string, unknown>;
    const timestamp = (persisted.createdAt as Date).toISOString();
    expect(timestamp).toBe(new Date(previousDate.getTime() + 1).toISOString());
    expect(persisted.previousHash).toBe("previous-hash");
    expect(persisted.eventHash).toBe(hashAuditPayload({
      workspaceId: "workspace-1", actorId: "user-1", entityType: "Invoice", entityId: "invoice-1", action: "EVALUATED",
      metadata: { score: 25, decision: "REVIEW" }, previousHash: "previous-hash", createdAt: timestamp
    }));
    expect(result).toEqual(persisted);
  });
});
