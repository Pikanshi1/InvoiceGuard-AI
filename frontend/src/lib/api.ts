const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function getActiveWorkspaceId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("invoiceguard_workspace_id");
}

export function setActiveWorkspaceId(id: string) {
  if (typeof window !== "undefined") window.localStorage.setItem("invoiceguard_workspace_id", id);
}

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  totalPages: number;
};

export function paginatedPath(path: string, page?: number, limit?: number): string {
  const params = new URLSearchParams();
  if (page !== undefined) params.set("page", String(page));
  if (limit !== undefined) params.set("limit", String(limit));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function workspaceHeaders() {
  const headers = new Headers();
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) headers.set("x-workspace-id", workspaceId);
  return headers;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) headers.set("x-workspace-id", workspaceId);
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(body.error ?? "Request failed.", response.status, body.code);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export async function apiDownload(path: string, fileName: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: workspaceHeaders()
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(body.error ?? "Unable to download file.", response.status, body.code);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function apiPaginatedRequest<T>(path: string, page?: number, limit?: number, init?: RequestInit): Promise<PaginatedResponse<T>> {
  return apiRequest<PaginatedResponse<T>>(paginatedPath(path, page, limit), init);
}
