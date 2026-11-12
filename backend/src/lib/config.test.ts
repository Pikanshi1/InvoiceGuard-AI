import { describe, expect, it } from "vitest";
import { getRuntimeConfig } from "./config";

describe("production runtime configuration", () => {
  it("requires a secure origin and PostgreSQL URL in production", () => {
    expect(() => getRuntimeConfig({ NODE_ENV: "production", WEB_ORIGIN: "http://example.test", DATABASE_URL: "postgresql://db" })).toThrow(/HTTPS/);
    expect(() => getRuntimeConfig({ NODE_ENV: "production", WEB_ORIGIN: "https://example.test" })).toThrow(/DATABASE_URL/);
  });

  it("accepts a valid production configuration without exposing its values", () => {
    expect(getRuntimeConfig({ NODE_ENV: "production", WEB_ORIGIN: "https://example.test", DATABASE_URL: "postgresql://db" })).toEqual({
      nodeEnv: "production", port: 4000, webOrigin: "https://example.test", trustProxyHops: null
    });
  });

  it("rejects invalid port and proxy-hop settings", () => {
    expect(() => getRuntimeConfig({ NODE_ENV: "test", PORT: "0" })).toThrow(/PORT/);
    expect(() => getRuntimeConfig({ NODE_ENV: "test", TRUST_PROXY_HOPS: "9" })).toThrow(/TRUST_PROXY_HOPS/);
  });
});
