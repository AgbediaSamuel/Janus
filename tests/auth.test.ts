import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  JANUS_MODE: process.env.JANUS_MODE,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
let server: Server;
let base: string;
let membershipFailure = false;
let upstreamCalls: string[] = [];

before(async () => {
  process.env.JANUS_MODE = "live";
  process.env.SUPABASE_URL = "https://janus-auth-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const { authenticate, requireOrganization } = await import("../server/auth");
  const { HttpError, liveMode } = await import("../server/config");
  assert.equal(liveMode, true);

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://janus-auth-test.supabase.co");
    const headers = new Headers(
      input instanceof Request ? input.headers : init.headers,
    );
    upstreamCalls.push(url.pathname);
    assert.equal(headers.get("apikey"), "test-service-role-key");
    if (url.pathname === "/auth/v1/user") {
      const token = headers.get("Authorization");
      const users: Record<string, string> = {
        "Bearer token-a": "user-a",
        "Bearer token-b": "user-b",
        "Bearer token-empty": "user-empty",
      };
      if (!token || !users[token])
        return Response.json(
          { code: "bad_jwt", message: "Invalid token" },
          { status: 401 },
        );
      return Response.json({
        id: users[token],
        aud: "authenticated",
        role: "authenticated",
        email: `${users[token]}@example.test`,
      });
    }
    assert.equal(url.pathname, "/rest/v1/organization_members");
    assert.equal(url.searchParams.get("select"), "organization_id");
    assert.equal(headers.get("Authorization"), "Bearer test-service-role-key");
    if (membershipFailure)
      return Response.json(
        { code: "42501", message: "Membership query denied" },
        { status: 403 },
      );
    const user = url.searchParams.get("user_id");
    assert.ok(["eq.user-a", "eq.user-b", "eq.user-empty"].includes(user || ""));
    const memberships =
      user === "eq.user-a"
        ? [{ organization_id: "org-a" }]
        : user === "eq.user-b"
          ? [{ organization_id: "org-b" }]
          : [];
    return Response.json(memberships);
  };

  const app = express();
  app.use(authenticate);
  app.get("/organizations/:id", (req, res) => {
    const identity = requireOrganization(res, String(req.params.id));
    res.json({ userId: identity.userId, organizationId: req.params.id });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = error instanceof HttpError ? error.status : 500;
      res
        .status(status)
        .json({
          error:
            status === 500
              ? "Authentication lookup failed"
              : (error as Error).message,
        });
    },
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  membershipFailure = false;
  upstreamCalls = [];
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function request(organizationId: string, token?: string) {
  const response = await originalFetch(
    `${base}/organizations/${organizationId}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  return { status: response.status, body: await response.json() };
}

test("live authentication rejects absent tokens before contacting Supabase", async () => {
  assert.equal((await request("org-a")).status, 401);
  assert.deepEqual(upstreamCalls, []);
});

test("live authentication rejects an invalid token without reading memberships", async () => {
  assert.equal((await request("org-a", "invalid-token")).status, 401);
  assert.deepEqual(upstreamCalls, ["/auth/v1/user"]);
});

test("distinct authenticated users can access only their own organization", async () => {
  assert.deepEqual(await request("org-a", "token-a"), {
    status: 200,
    body: { userId: "user-a", organizationId: "org-a" },
  });
  assert.deepEqual(await request("org-b", "token-b"), {
    status: 200,
    body: { userId: "user-b", organizationId: "org-b" },
  });
  assert.equal((await request("org-b", "token-a")).status, 403);
  assert.equal((await request("org-a", "token-b")).status, 403);
});

test("an authenticated user without memberships cannot access an organization", async () => {
  assert.equal((await request("org-a", "token-empty")).status, 403);
  assert.deepEqual(upstreamCalls, [
    "/auth/v1/user",
    "/rest/v1/organization_members",
  ]);
});

test("a failed membership lookup denies access instead of retaining a previous identity", async () => {
  assert.equal((await request("org-a", "token-a")).status, 200);
  membershipFailure = true;
  const result = await request("org-a", "token-a");
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: "Authentication lookup failed" });
});
