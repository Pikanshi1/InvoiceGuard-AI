export type RuntimeConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  webOrigin: string;
  trustProxyHops: number | null;
};

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = (env.NODE_ENV ?? "development") as RuntimeConfig["nodeEnv"];
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("NODE_ENV must be development, test, or production.");
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  const webOrigin = env.WEB_ORIGIN ?? (nodeEnv === "production" ? "" : "http://localhost:3000");
  if (!webOrigin) throw new Error("WEB_ORIGIN is required in production.");
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(webOrigin); } catch { throw new Error("WEB_ORIGIN must be a valid absolute URL."); }
  if (!parsedOrigin.origin || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) throw new Error("WEB_ORIGIN must contain only an origin, without a path or query.");
  if (nodeEnv === "production") {
    if (parsedOrigin.protocol !== "https:") throw new Error("WEB_ORIGIN must use HTTPS in production.");
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required in production.");
    if (!/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL)) throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  const trustProxyHops = env.TRUST_PROXY_HOPS ? Number(env.TRUST_PROXY_HOPS) : null;
  if (trustProxyHops !== null && (!Number.isInteger(trustProxyHops) || trustProxyHops < 1 || trustProxyHops > 5)) {
    throw new Error("TRUST_PROXY_HOPS must be an integer from 1 to 5.");
  }
  return { nodeEnv, port, webOrigin: parsedOrigin.origin, trustProxyHops };
}
