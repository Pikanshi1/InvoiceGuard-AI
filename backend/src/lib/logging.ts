export function logServerError(event: string, error?: unknown, requestId?: string) {
  const metadata: Record<string, string> = { level: "error", event };
  if (requestId) metadata.requestId = requestId;
  if (error && typeof error === "object") {
    if ("name" in error && typeof error.name === "string") metadata.errorName = error.name.slice(0, 80);
    if ("code" in error && typeof error.code === "string") metadata.errorCode = error.code.slice(0, 80);
  }
  console.error(JSON.stringify(metadata));
}
