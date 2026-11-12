import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type AuditEventInput = {
  workspaceId: string;
  actorId?: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
};

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sortJsonKeys(item)]));
  }
  return value;
}

export function hashAuditPayload(payload: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(sortJsonKeys(payload))).digest("hex");
}

export async function recordAuditEventInTransaction(tx: Prisma.TransactionClient, input: AuditEventInput) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.workspaceId})::bigint)`;
  const previous = await tx.auditEvent.findFirst({
    where: { workspaceId: input.workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  const now = Date.now();
  const createdAt = new Date(Math.max(now, (previous?.createdAt.getTime() ?? now - 1) + 1));
  const previousHash = previous?.eventHash ?? null;
  const event = {
    workspaceId: input.workspaceId,
    actorId: input.actorId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    metadata: input.metadata ?? null,
    previousHash,
    createdAt: createdAt.toISOString()
  };
  const eventHash = hashAuditPayload(event);
  return tx.auditEvent.create({
    data: {
      ...event,
      metadata: input.metadata === undefined ? Prisma.DbNull : input.metadata,
      createdAt,
      eventHash
    }
  });
}

export async function recordAuditEvent(input: AuditEventInput) {
  return prisma.$transaction(tx => recordAuditEventInTransaction(tx, input));
}
