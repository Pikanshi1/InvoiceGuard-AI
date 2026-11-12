"use client";

import { useEffect, useState } from "react";
import { apiDownload, apiPaginatedRequest, apiRequest } from "@/lib/api";

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  createdAt: string;
};

type Props = {
  endpoint: string;
  title?: string;
};

export function DocumentAttachmentManager({ endpoint, title = "Supporting documents" }: Props) {
  const [documents, setDocuments] = useState<Attachment[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const result = await apiPaginatedRequest<Attachment>(endpoint, 1, 50);
    setDocuments(result.data);
  }

  useEffect(() => {
    refresh().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load documents."));
  }, [endpoint]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("document", file);
      await apiRequest(endpoint, { method: "POST", body });
      setFile(null);
      form.reset();
      await refresh();
      setMessage("Document uploaded and recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to upload document.");
    } finally {
      setBusy(false);
    }
  }

  async function download(document: Attachment) {
    setBusy(true);
    setMessage("");
    try {
      await apiDownload(`${endpoint}/${encodeURIComponent(document.id)}/download`, document.fileName);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to download document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-slate-200">{title}</h3>
        <span className="text-[10px] text-slate-500">{documents.length} file{documents.length === 1 ? "" : "s"}</span>
      </div>
      <form onSubmit={upload} className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          required
          accept=".pdf,.txt,.png,.jpg,.jpeg,application/pdf,text/plain,image/png,image/jpeg"
          onChange={event => setFile(event.target.files?.[0] ?? null)}
          className="min-w-0 flex-1 text-xs text-slate-300 file:mr-2 file:rounded-lg file:border-0 file:bg-white/10 file:px-2 file:py-1.5 file:text-xs file:text-slate-200"
        />
        <button disabled={busy || !file} className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">
          {busy ? "Working…" : "Upload"}
        </button>
      </form>
      <p className="mt-1 text-[10px] text-slate-500">PDF, TXT, PNG or JPEG · Maximum 10 MB</p>
      {documents.length > 0 && <ul className="mt-3 space-y-2">
        {documents.map(document => (
          <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span className="min-w-0 break-all">{document.fileName}</span>
            <div className="flex items-center gap-3">
              <span className="text-slate-500">{Math.max(1, Math.round(document.sizeBytes / 1024))} KB</span>
              <button type="button" disabled={busy} onClick={() => download(document)} className="text-cyan-200 underline disabled:opacity-50">Download</button>
            </div>
          </li>
        ))}
      </ul>}
      {message && <p role="status" aria-live="polite" className="mt-2 text-xs text-cyan-200">{message}</p>}
    </section>
  );
}
