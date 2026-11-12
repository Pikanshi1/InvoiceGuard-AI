
"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

export default function PendingVerificationPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function resendVerification() {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const result = await apiRequest<{ message: string }>(
        "/auth/resend-verification",
        { method: "POST" }
      );
      setMessage(result.message || "Verification email sent. Please check your inbox.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to resend verification email."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell grid min-h-screen place-items-center px-6 text-slate-100">
      <div className="auth-theme-toggle"><ThemeToggle /></div>
      <div className="auth-card w-full max-w-md rounded-[2rem] border border-white/10 p-8 text-center shadow-2xl backdrop-blur-xl">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-300 to-emerald-300 text-slate-950">
          <Mail size={24} />
        </span>

        <div className="mt-5 flex items-center justify-center gap-2 font-semibold">
          <ShieldCheck className="text-cyan-300" size={18} />
          InvoiceGuard<span className="text-cyan-300">.</span>
        </div>

        <h1 className="mt-6 text-3xl font-semibold text-white">
          Check your email
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-400">
          Your account has been created. Please open the verification link
          sent to your registered email address before signing in.
        </p>

        {message && (
          <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">
            {message}
          </p>
        )}

        {error && (
          <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={resendVerification}
          disabled={loading}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-300 px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
          {loading ? "Sending..." : "Resend verification email"}
        </button>

        <Link
          href="/login"
          className="mt-5 inline-block text-sm text-slate-400 transition hover:text-cyan-300"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
