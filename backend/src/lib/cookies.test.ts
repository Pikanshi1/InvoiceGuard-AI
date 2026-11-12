import { describe, expect, it } from "vitest";
import { readCookie } from "./cookies";

function request(cookie?: string) {
  return { headers: cookie ? { cookie } : {} } as import("express").Request;
}

describe("readCookie", () => {
  it("reads and decodes a named cookie", () => {
    expect(readCookie(request("other=value; invoiceguard_session=abc%2F123"), "invoiceguard_session")).toBe("abc/123");
  });

  it("does not match a cookie with a longer name prefix", () => {
    expect(readCookie(request("not_invoiceguard_session=secret"), "invoiceguard_session")).toBeUndefined();
  });

  it("returns undefined for malformed percent encoding", () => {
    expect(readCookie(request("invoiceguard_session=%E0%A4%A"), "invoiceguard_session")).toBeUndefined();
  });

  it("returns undefined when the cookie is absent", () => {
    expect(readCookie(request(), "invoiceguard_session")).toBeUndefined();
  });
});
