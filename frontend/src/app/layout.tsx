import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "InvoiceGuard AI — Secure procurement intelligence",
  description: "Intelligent procurement and payment security platform."
};

const themeBootstrap = `(() => {
  try {
    const saved = localStorage.getItem("invoiceguard-theme");
    const light = saved ? saved === "light" : window.matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.classList.toggle("light-theme", light);
  } catch {}
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="invoiceguard-theme-bootstrap" strategy="beforeInteractive">{themeBootstrap}</Script>
        {children}
      </body>
    </html>
  );
}
