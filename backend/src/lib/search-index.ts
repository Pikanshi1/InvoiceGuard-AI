export async function indexWorkspaceRecord(input: {
  workspaceId: string;
  entityType: string;
  entityId: string;
  document: Record<string, unknown>;
}) {
  if (!process.env.ELASTIC_URL) return;
  try {
    const response = await fetch(`${process.env.ELASTIC_URL.replace(/\/$/, "")}/invoiceguard/_doc/${encodeURIComponent(`${input.entityType}:${input.entityId}`)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ELASTIC_API_KEY ? { Authorization: `ApiKey ${process.env.ELASTIC_API_KEY}` } : {})
      },
      body: JSON.stringify({ ...input.document, workspaceId: input.workspaceId, entityType: input.entityType, entityId: input.entityId }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) console.error("Elasticsearch indexing failed", { entityType: input.entityType, entityId: input.entityId, status: response.status });
  } catch (error) {
    console.error("Elasticsearch indexing request failed", { entityType: input.entityType, entityId: input.entityId });
  }
}
