import { describe, expect, it } from "vitest";
import { GET } from "../api/health.js";
import { health } from "../src/health.js";

describe("health", () => {
  it("reports the short commit on Vercel", () => {
    expect(health({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" })).toEqual({
      status: "ok",
      service: "__SCOPE__-api",
      version: "0123456",
    });
  });

  it("falls back to dev locally", () => {
    expect(health({}).version).toBe("dev");
  });

  it("serves JSON without caching", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "ok", service: "__SCOPE__-api" });
  });
});
