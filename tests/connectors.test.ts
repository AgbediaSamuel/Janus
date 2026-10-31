import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  connectorDefinitions,
  ConnectorCredentialStore,
  executeConnector,
  validateCredentials,
} from "../server/connectors/index.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

test("Teams reads and replies stay bound to the configured team and channel", async () => {
  const credentials = { token: "teams-oauth", teamId: "team-a", channelId: "19:channel@thread.tacv2" };
  mockResponse({ value: [] }, (url, init) => {
    assert.equal(url.origin, "https://graph.microsoft.com");
    assert.equal(url.pathname, "/v1.0/teams/team-a/channels/19%3Achannel%40thread.tacv2/messages/message-1/replies");
    assert.equal(url.searchParams.get("$top"), "25");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer teams-oauth");
  });
  await executeConnector({ connectorId: "teams", operationId: "replies", input: { messageId: "message-1" }, credentials });
  mockResponse({ id: "reply-1" }, (url, init) => {
    assert.equal(url.pathname.endsWith("/messages/message-1/replies"), true);
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { body: { contentType: "text", content: "Evidence received" } });
  });
  await executeConnector({ connectorId: "teams", operationId: "reply", input: { messageId: "message-1", text: "Evidence received" }, credentials });
});

test("Teams pagination accepts only its exact scoped collection and rejects channel overrides", async () => {
  const credentials = { token: "teams-oauth", teamId: "team-a", channelId: "channel-a" };
  let calls = 0;
  mockResponse({ value: [] }, (url) => { calls++; assert.equal(url.searchParams.get("$skiptoken"), "cursor"); });
  await executeConnector({ connectorId: "teams", operationId: "messages", input: { nextPage: "https://graph.microsoft.com/v1.0/teams/team-a/channels/channel-a/messages?$skiptoken=cursor" }, credentials });
  for (const nextPage of ["https://attacker.example/messages", "https://graph.microsoft.com/v1.0/teams/team-a/channels/other/messages", "https://graph.microsoft.com/v1.0/users/another/messages"]) {
    await assert.rejects(executeConnector({ connectorId: "teams", operationId: "messages", input: { nextPage }, credentials }), /configured collection/);
  }
  await assert.rejects(executeConnector({ connectorId: "teams", operationId: "messages", input: { channelId: "other" }, credentials }), /Invalid input/);
  assert.equal(calls, 1);
});

test("Outlook search and conversations use only the configured mailbox", async () => {
  const credentials = { token: "graph-oauth", mailbox: "support@example.com" };
  mockResponse({ value: [] }, (url, init) => {
    assert.equal(url.pathname, "/v1.0/users/support%40example.com/messages");
    assert.equal(url.searchParams.get("$search"), '"subject:incident"');
    assert.equal(new Headers(init.headers).get("Prefer"), 'outlook.body-content-type="text"');
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer graph-oauth");
  });
  await executeConnector({ connectorId: "outlook", operationId: "messages", input: { query: "subject:incident" }, credentials });
  mockResponse({ value: [] }, (url) => {
    assert.equal(url.searchParams.get("$filter"), "conversationId eq 'thread''quoted'");
  });
  await executeConnector({ connectorId: "outlook", operationId: "conversation", input: { conversationId: "thread'quoted" }, credentials });
});

test("Outlook send and reply report acceptance without claiming delivery", async () => {
  const credentials = { token: "graph-oauth", mailbox: "me" };
  mockResponse("", (url, init) => {
    assert.equal(url.pathname, "/v1.0/me/sendMail");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { message: { subject: "Incident", body: { contentType: "Text", content: "Evidence" }, toRecipients: [{ emailAddress: { address: "support@example.com" } }] }, saveToSentItems: true });
  }, 202);
  assert.deepEqual(await executeConnector({ connectorId: "outlook", operationId: "send", input: { to: ["support@example.com"], subject: "Incident", text: "Evidence" }, credentials }), { accepted: true, delivered: false });
  mockResponse("", (url, init) => {
    assert.equal(url.pathname, "/v1.0/me/messages/message-1/reply");
    assert.deepEqual(JSON.parse(String(init.body)), { message: { body: { contentType: "Text", content: "Update" } } });
  }, 202);
  assert.deepEqual(await executeConnector({ connectorId: "outlook", operationId: "reply", input: { messageId: "message-1", text: "Update" }, credentials }), { accepted: true, delivered: false });
});

test("Outlook pagination cannot escape the configured mailbox", async () => {
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
  await assert.rejects(executeConnector({ connectorId: "outlook", operationId: "messages", input: { nextPage: "https://graph.microsoft.com/v1.0/users/other/messages?$skip=10" }, credentials: { token: "oauth", mailbox: "me" } }), /configured collection/);
});

test("Gmail search uses users/me and provider page tokens; thread read requests full content", async () => {
  const credentials = { token: "gmail-oauth" };
  mockResponse({ threads: [] }, (url, init) => {
    assert.equal(url.origin, "https://gmail.googleapis.com");
    assert.equal(url.pathname, "/gmail/v1/users/me/threads");
    assert.equal(url.searchParams.get("q"), "subject:incident");
    assert.equal(url.searchParams.get("pageToken"), "next-page");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer gmail-oauth");
  });
  await executeConnector({ connectorId: "gmail", operationId: "threads", input: { query: "subject:incident", pageToken: "next-page" }, credentials });
  mockResponse({ messages: [] }, (url) => {
    assert.equal(url.pathname, "/gmail/v1/users/me/threads/thread-1");
    assert.equal(url.searchParams.get("format"), "full");
  });
  await executeConnector({ connectorId: "gmail", operationId: "thread", input: { threadId: "thread-1" }, credentials });
});

test("Gmail send builds base64url MIME with the authenticated sender and encoded body", async () => {
  const requests: string[] = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); requests.push(url.pathname);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer gmail-oauth");
    if (url.pathname.endsWith("/profile")) return Response.json({ emailAddress: "customer@example.com" });
    assert.equal(url.pathname, "/gmail/v1/users/me/messages/send");
    const body = JSON.parse(String(init.body));
    assert.match(body.raw, /^[A-Za-z0-9_-]+$/);
    const mime = Buffer.from(body.raw, "base64url").toString();
    assert.match(mime, /From: customer@example.com\r\nTo: support@example.com/);
    assert.match(mime, /Subject: =\?UTF-8\?B\?/);
    assert.equal(Buffer.from(mime.split("\r\n\r\n")[1], "base64").toString(), "Hello ✓");
    assert.equal(body.threadId, undefined);
    return Response.json({ id: "sent-1" });
  };
  await executeConnector({ connectorId: "gmail", operationId: "send", input: { to: ["support@example.com"], subject: "Incident ✓", text: "Hello ✓" }, credentials: { token: "gmail-oauth" } });
  assert.equal(requests.length, 2);
});

test("Gmail replies retain thread, parent Message-ID, references, and Reply-To recipient", async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages/parent-1")) {
      assert.equal(url.searchParams.get("format"), "metadata");
      return Response.json({ threadId: "thread-1", payload: { headers: [
        { name: "From", value: "Vendor <sender@example.com>" },
        { name: "Reply-To", value: "Support <support@example.com>" },
        { name: "Subject", value: "Incident" },
        { name: "Message-ID", value: "<parent@example.com>" },
        { name: "References", value: "<first@example.com>" },
      ] } });
    }
    if (url.pathname.endsWith("/profile")) return Response.json({ emailAddress: "customer@example.com" });
    assert.equal(url.pathname, "/gmail/v1/users/me/messages/send");
    const body = JSON.parse(String(init.body));
    assert.equal(body.threadId, "thread-1");
    const mime = Buffer.from(body.raw, "base64url").toString();
    assert.match(mime, /To: support@example.com\r\n/);
    assert.match(mime, /In-Reply-To: <parent@example.com>\r\nReferences: <first@example.com> <parent@example.com>/);
    return Response.json({ id: "reply-1", threadId: "thread-1" });
  };
  await executeConnector({ connectorId: "gmail", operationId: "reply", input: { messageId: "parent-1", text: "Evidence received" }, credentials: { token: "gmail-oauth" } });
});

test("Email rejects header injection before sending and never accepts a mailbox override", async () => {
  let sends = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/send")) sends++;
    return Response.json({ threadId: "thread-1", payload: { headers: [{ name: "From", value: "user@example.com\r\nBcc: attacker@example.com" }] } });
  };
  const credentials = { token: "gmail-oauth" };
  await assert.rejects(executeConnector({ connectorId: "gmail", operationId: "send", input: { to: ["user@example.com"], subject: "Hello\r\nBcc: attacker@example.com", text: "Test" }, credentials }), /single line/);
  await assert.rejects(executeConnector({ connectorId: "gmail", operationId: "reply", input: { messageId: "parent", text: "Test" }, credentials }), /unsupported mail header/);
  await assert.rejects(executeConnector({ connectorId: "gmail", operationId: "messages", input: { userId: "other@example.com" }, credentials }), /Invalid input/);
  assert.equal(sends, 0);
});

test("Messaging mutation metadata requires approval and provider errors hide token/content", async () => {
  for (const id of ["teams", "outlook", "gmail"]) {
    const definition = connectorDefinitions.find((item) => item.id === id)!;
    assert.equal(definition.authFields.find((field) => field.key === "token")?.secret, true);
    for (const operation of definition.operations)
      assert.equal(operation.write, ["send", "post", "reply"].includes(operation.id));
  }
  mockResponse({ error: "secret-token private email content" }, () => {}, 403);
  await assert.rejects(executeConnector({ connectorId: "gmail", operationId: "messages", input: {}, credentials: { token: "secret-token" } }), { message: "Provider returned HTTP 403" });
});

function mockResponse(
  body: unknown,
  inspect: (url: URL, init: RequestInit) => void = () => {},
  status = 200,
): void {
  globalThis.fetch = async (input, init = {}) => {
    inspect(new URL(String(input)), init);
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status },
    );
  };
}

test("credentials are isolated by organization and copied on read/write", () => {
  const store = new ConnectorCredentialStore();
  const credentials = { token: "customer" };
  store.set("customer", "slack", credentials);
  store.set("vendor", "slack", { token: "vendor" });
  credentials.token = "mutated";
  const read = store.get("customer", "slack");
  read.token = "mutated again";
  assert.equal(store.get("customer", "slack").token, "customer");
  assert.equal(store.get("vendor", "slack").token, "vendor");
  assert.throws(
    () => store.get("other", "slack"),
    /not configured for this organization/,
  );
});

test("missing credentials and invalid operations never make a request", async () => {
  globalThis.fetch = async () => {
    throw new Error("should not reach network");
  };
  assert.throws(
    () => validateCredentials("slack", {}),
    /Missing credential field: token/,
  );
  assert.throws(
    () =>
      validateCredentials("azure-blob", {
        baseUrl: "https://account.blob.core.windows.net",
        container: "logs",
      }),
    /sas or token/,
  );
  await assert.rejects(
    executeConnector({
      connectorId: "slack",
      operationId: "delete",
      input: {},
      credentials: { token: "secret" },
    }),
    /Unknown connector operation/,
  );
});

test("Slack search uses bearer auth and encodes the search query", async () => {
  mockResponse({ ok: true, messages: { matches: [] } }, (url, init) => {
    assert.equal(url.pathname, "/api/search.messages");
    assert.equal(url.searchParams.get("query"), "in:incidents error & timeout");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer slack-secret",
    );
    assert.equal(init.redirect, "error");
    assert.equal(url.href.includes("slack-secret"), false);
  });
  await executeConnector({
    connectorId: "slack",
    operationId: "search",
    input: { query: "in:incidents error & timeout" },
    credentials: { token: "slack-secret" },
  });
});

test("Slack rejects unsuccessful API responses without echoing provider content", async () => {
  mockResponse({ ok: false, error: "secret-token-value" });
  await assert.rejects(
    executeConnector({
      connectorId: "slack",
      operationId: "search",
      input: { query: "error" },
      credentials: { token: "secret-token-value" },
    }),
    (error) => {
      assert.match(String(error), /Slack rejected/);
      assert.equal(String(error).includes("secret-token-value"), false);
      return true;
    },
  );
});

test("Linear uses variables and personal-key auth for create mutation", async () => {
  mockResponse(
    { data: { issueCreate: { success: true, issue: { id: "1" } } } },
    (_url, init) => {
      const body = JSON.parse(String(init.body));
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        "lin_api_secret",
      );
      assert.equal(body.variables.input.title, 'quote " in title');
      assert.equal(body.query.includes("quote"), false);
    },
  );
  await executeConnector({
    connectorId: "linear",
    operationId: "create",
    credentials: { token: "lin_api_secret" },
    input: { teamId: "team", title: 'quote " in title' },
  });
});

test("Datadog uses both API and app key with a fixed site allowlist", async () => {
  let count = 0;
  mockResponse({ data: [] }, (url, init) => {
    count++;
    assert.equal(url.host, "api.datadoghq.eu");
    assert.equal(new Headers(init.headers).get("DD-API-KEY"), "api-secret");
    assert.equal(
      new Headers(init.headers).get("DD-APPLICATION-KEY"),
      "app-secret",
    );
    assert.equal(JSON.parse(String(init.body)).filter.from, "now-1h");
  });
  const options = {
    connectorId: "datadog",
    operationId: "logs",
    input: { query: "status:error", from: "now-1h", to: "now" },
    credentials: {
      apiKey: "api-secret",
      appKey: "app-secret",
      site: "datadoghq.eu",
    },
  };
  await executeConnector(options);
  await assert.rejects(
    executeConnector({
      ...options,
      credentials: { ...options.credentials, site: "evil.example" },
    }),
    /Unsupported Datadog site/,
  );
  assert.equal(count, 1);
});

test("Splunk cannot execute pipeline commands, subsearches or macros", async () => {
  let count = 0;
  mockResponse(
    '{"result":{"message":"error"}}\n{"result":{"message":"next"}}\n',
    (_url, init) => {
      count++;
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("search"), "search index=main error | head 25");
      assert.equal(body.get("output_mode"), "json");
    },
  );
  const options = {
    connectorId: "splunk",
    operationId: "search",
    credentials: { token: "secret", baseUrl: "https://splunk.example:8089" },
    input: { query: "index=main error", earliest: "-15m", latest: "now" },
  };
  const result = await executeConnector(options);
  assert.equal((result as unknown[]).length, 2);
  for (const query of [
    "index=main | delete",
    "[search index=other]",
    "`macro`",
  ]) {
    await assert.rejects(
      executeConnector({ ...options, input: { ...options.input, query } }),
      /Invalid input/,
    );
  }
  assert.equal(count, 1);
});

test("Azure Monitor scopes the query to the configured workspace", async () => {
  mockResponse({ tables: [] }, (url, init) => {
    assert.equal(
      url.href,
      "https://api.loganalytics.azure.com/v1/workspaces/workspace-1/query",
    );
    assert.deepEqual(JSON.parse(String(init.body)), {
      query: "AzureActivity | take 5",
      timespan: "PT1H",
    });
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer entra-token",
    );
  });
  await executeConnector({
    connectorId: "azure-monitor",
    operationId: "query",
    input: { query: "AzureActivity | take 5", timespan: "PT1H" },
    credentials: { token: "entra-token", workspaceId: "workspace-1" },
  });
});

test("Blob SAS is preserved, names are encoded, and SAS is not used as bearer auth", async () => {
  mockResponse("example", (url, init) => {
    assert.equal(url.pathname, "/logs/folder/error%20message.txt");
    assert.equal(url.searchParams.get("sig"), "a+b=");
    assert.equal(new Headers(init.headers).get("Authorization"), null);
    assert.equal(new Headers(init.headers).get("x-ms-version"), "2023-11-03");
  });
  await executeConnector({
    connectorId: "azure-blob",
    operationId: "read",
    input: { name: "folder/error message.txt" },
    credentials: {
      baseUrl: "https://account.blob.core.windows.net",
      container: "logs",
      sas: "sv=2023-11-03&sig=a%2Bb%3D",
    },
  });
});

test("Cloud Logging uses configured project and pagination token", async () => {
  mockResponse({ entries: [], nextPageToken: "next" }, (url, init) => {
    assert.equal(url.href, "https://logging.googleapis.com/v2/entries:list");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.resourceNames, ["projects/customer-project"]);
    assert.equal(body.pageToken, "cursor");
  });
  await executeConnector({
    connectorId: "gcp-logging",
    operationId: "logs",
    input: { filter: "severity>=ERROR", pageToken: "cursor" },
    credentials: { token: "google-token", projectId: "customer-project" },
  });
});

test("Stripe false delivery filter is sent rather than omitted", async () => {
  mockResponse({ data: [], has_more: false }, (url, init) => {
    assert.equal(url.searchParams.get("delivery_success"), "false");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer sk_test_example",
    );
  });
  await executeConnector({
    connectorId: "stripe",
    operationId: "events",
    input: { deliverySuccess: false },
    credentials: { token: "sk_test_example" },
  });
});

test("generic HTTP cannot escape configured origin or base path", async () => {
  let requests = 0;
  mockResponse({ healthy: true }, () => {
    requests++;
  });
  const options = {
    connectorId: "http",
    operationId: "request",
    credentials: { baseUrl: "https://service.example/api", token: "secret" },
    input: { method: "GET", path: "health" },
  };
  await executeConnector(options);
  for (const path of [
    "https://evil.example/x",
    "//evil.example/x",
    "../admin",
    "/outside",
    "https://user:password@service.example/api/x",
  ]) {
    await assert.rejects(
      executeConnector({ ...options, input: { method: "GET", path } }),
      /configured endpoint/,
    );
  }
  assert.equal(requests, 1);
});

test("network/provider errors omit credentials and raw response bodies", async () => {
  const options = {
    connectorId: "stripe",
    operationId: "events",
    input: {},
    credentials: { token: "super-secret" },
  };
  mockResponse("super-secret upstream debug", () => {}, 401);
  await assert.rejects(
    executeConnector(options),
    /^Error: Provider returned HTTP 401$/,
  );
  globalThis.fetch = async () => {
    throw new Error("https://endpoint.example/?token=super-secret");
  };
  await assert.rejects(
    executeConnector(options),
    (error) => !String(error).includes("super-secret"),
  );
});

test("mutation-capable operations are marked for approval", () => {
  for (const [connectorId, operationId] of [
    ["slack", "post"],
    ["github", "create"],
    ["linear", "create"],
    ["bigquery", "query"],
    ["http", "request"],
    ["mcp", "call_tool"],
    ["work-iq", "call_tool"],
  ]) {
    const operation = connectorDefinitions
      .find((item) => item.id === connectorId)
      ?.operations.find((item) => item.id === operationId);
    assert.equal(operation?.write, true, `${connectorId}/${operationId}`);
  }
});

test("strict input schemas reject unexpected scope overrides", async () => {
  globalThis.fetch = async () => {
    throw new Error("should not reach network");
  };
  await assert.rejects(
    executeConnector({
      connectorId: "gcp-logging",
      operationId: "logs",
      input: { filter: "error", projectId: "other-org" },
      credentials: { token: "secret", projectId: "customer-project" },
    }),
    /Invalid input/,
  );
});

test("AWS SDK receives explicit temporary credentials and configured bucket", async () => {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const calls: unknown[] = [];
  mock.method(
    S3Client.prototype,
    "send",
    async function (
      this: InstanceType<typeof S3Client>,
      command: { input: unknown },
    ) {
      const credentials = await this.config.credentials();
      assert.equal(credentials.accessKeyId, "test-access");
      assert.equal(credentials.secretAccessKey, "test-secret");
      assert.equal(credentials.sessionToken, "test-session");
      assert.equal(await this.config.region(), "us-west-2");
      calls.push(command.input);
      return { Contents: [{ Key: "logs/error.txt" }] };
    },
  );
  await executeConnector({
    connectorId: "aws-s3",
    operationId: "list",
    input: { prefix: "logs/", continuationToken: "cursor" },
    credentials: {
      region: "us-west-2",
      accessKeyId: "test-access",
      secretAccessKey: "test-secret",
      sessionToken: "test-session",
      bucket: "customer-evidence",
    },
  });
  assert.deepEqual(calls, [
    {
      Bucket: "customer-evidence",
      Prefix: "logs/",
      MaxKeys: 25,
      ContinuationToken: "cursor",
    },
  ]);
});

test("PostgreSQL uses a read-only transaction, a named statement, and closes the connection", async () => {
  const { Client } = await import("pg");
  const calls: unknown[] = [];
  mock.method(Client.prototype, "connect", async () => {
    calls.push("connect");
  });
  mock.method(Client.prototype, "query", async (query: unknown) => {
    calls.push(query);
    return {
      rows: [{ status: "failed" }],
      rowCount: 1,
      fields: [{ name: "status", dataTypeID: 25 }],
    };
  });
  mock.method(Client.prototype, "end", async () => {
    calls.push("end");
  });
  const result = await executeConnector({
    connectorId: "postgres",
    operationId: "query",
    input: {
      query: "SELECT status FROM deliveries WHERE id = $1",
      parameters: ["delivery-1"],
    },
    credentials: {
      connectionString: "postgresql://reader:secret@db.example/app",
    },
  });
  assert.deepEqual(calls, [
    "connect",
    "BEGIN READ ONLY",
    {
      name: "janus-read-query",
      text: "SELECT status FROM deliveries WHERE id = $1",
      values: ["delivery-1"],
    },
    "ROLLBACK",
    "end",
  ]);
  assert.deepEqual(result, {
    rows: [{ status: "failed" }],
    rowCount: 1,
    fields: [{ name: "status", dataTypeID: 25 }],
  });
});

test("PostgreSQL closes on query failure and does not leak the connection string", async () => {
  const { Client } = await import("pg");
  let closed = false;
  mock.method(Client.prototype, "connect", async () => {});
  mock.method(Client.prototype, "query", async () => {
    throw new Error("postgresql://reader:secret@db.example/app");
  });
  mock.method(Client.prototype, "end", async () => {
    closed = true;
  });
  await assert.rejects(
    executeConnector({
      connectorId: "postgres",
      operationId: "query",
      input: { query: "SELECT 1" },
      credentials: {
        connectionString: "postgresql://reader:secret@db.example/app",
      },
    }),
    (error) => !String(error).includes("secret"),
  );
  assert.equal(closed, true);
});

test("remote MCP performs protocol initialization and authenticated tool discovery", async () => {
  const methods: string[] = [];
  globalThis.fetch = async (_url, init = {}) => {
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer mcp-secret",
    );
    if (init.method === "GET") return new Response(null, { status: 405 });
    const message = JSON.parse(String(init.body));
    methods.push(message.method);
    if (message.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "test-provider", version: "1.0.0" },
          }
        : {
            tools: [
              {
                name: "read_evidence",
                description: "Read evidence",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  const result = await executeConnector({
    connectorId: "mcp",
    operationId: "list_tools",
    input: {},
    credentials: { baseUrl: "https://mcp.example/tools", token: "mcp-secret" },
  });
  assert.deepEqual(methods, [
    "initialize",
    "notifications/initialized",
    "tools/list",
  ]);
  assert.equal(
    (result as { tools: { name: string }[] }).tools[0].name,
    "read_evidence",
  );
});

test("GitHub diagnostic reads stay scoped to the repository and expose changes and workflow steps", async () => {
  const scenarios = [
    {
      operationId: "commits",
      input: { sha: "release/1" },
      endpoint: "/commits",
      parameter: ["sha", "release/1"],
    },
    {
      operationId: "commit",
      input: { ref: "release/1" },
      endpoint: "/commits/release%2F1",
    },
    {
      operationId: "compare",
      input: { base: "old", head: "new" },
      endpoint: "/compare/old...new",
    },
    {
      operationId: "deployments",
      input: { environment: "production" },
      endpoint: "/deployments",
      parameter: ["environment", "production"],
    },
    {
      operationId: "deployment_statuses",
      input: { deploymentId: 7 },
      endpoint: "/deployments/7/statuses",
    },
    {
      operationId: "workflow_runs",
      input: { status: "failure" },
      endpoint: "/actions/runs",
      parameter: ["status", "failure"],
    },
    {
      operationId: "workflow_jobs",
      input: { runId: 9 },
      endpoint: "/actions/runs/9/jobs",
    },
  ];
  for (const scenario of scenarios) {
    mockResponse({}, (url, init) => {
      assert.equal(
        url.pathname,
        `/repos/customer/application${scenario.endpoint}`,
      );
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        "Bearer github-secret",
      );
      if (scenario.parameter)
        assert.equal(
          url.searchParams.get(scenario.parameter[0]),
          scenario.parameter[1],
        );
    });
    await executeConnector({
      connectorId: "github",
      operationId: scenario.operationId,
      input: scenario.input,
      credentials: {
        token: "github-secret",
        owner: "customer",
        repo: "application",
      },
    });
  }
});

test("Vercel requests team-bound deployment detail and finite build logs", async () => {
  const credentials = { token: "vercel-secret", teamId: "team_customer" };
  mockResponse({ id: "dpl_1" }, (url, init) => {
    assert.equal(url.pathname, "/v13/deployments/dpl_1");
    assert.equal(url.searchParams.get("withGitRepoInfo"), "true");
    assert.equal(url.searchParams.get("teamId"), "team_customer");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer vercel-secret",
    );
  });
  await executeConnector({
    connectorId: "vercel",
    operationId: "deployment",
    input: { deploymentId: "dpl_1" },
    credentials,
  });
  mockResponse([], (url) => {
    assert.equal(url.pathname, "/v3/deployments/dpl_1/events");
    assert.equal(url.searchParams.get("follow"), "0");
    assert.equal(url.searchParams.get("limit"), "25");
    assert.equal(url.searchParams.get("since"), "1000");
  });
  await executeConnector({
    connectorId: "vercel",
    operationId: "build_events",
    input: { deploymentId: "dpl_1", since: 1000 },
    credentials,
  });
});

test("Supabase management binds the project and validates documented log windows", async () => {
  const credentials = {
    token: "management-secret",
    projectRef: "customer-project",
  };
  mockResponse([], (url, init) => {
    assert.equal(url.pathname, "/v1/projects/customer-project/health");
    assert.equal(url.searchParams.get("services"), "auth,rest");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer management-secret",
    );
  });
  await executeConnector({
    connectorId: "supabase",
    operationId: "health",
    input: { services: ["auth", "rest"] },
    credentials,
  });
  mockResponse([], (url) => {
    assert.equal(
      url.pathname,
      "/v1/projects/customer-project/analytics/endpoints/logs",
    );
    assert.equal(
      url.searchParams.get("iso_timestamp_start"),
      "2026-10-31T10:00:00Z",
    );
    assert.equal(url.searchParams.has("sql"), false);
  });
  await executeConnector({
    connectorId: "supabase",
    operationId: "logs",
    input: { from: "2026-10-31T10:00:00Z", to: "2026-10-31T11:00:00Z" },
    credentials,
  });
  await assert.rejects(
    executeConnector({
      connectorId: "supabase",
      operationId: "logs",
      input: { from: "2026-10-29T10:00:00Z", to: "2026-10-31T11:00:00Z" },
      credentials,
    }),
    /24 hours/,
  );
});

test("Auth0 log search encodes criteria and uses tenant management bearer auth", async () => {
  mockResponse({ logs: [] }, (url, init) => {
    assert.equal(url.origin, "https://tenant.us.auth0.com");
    assert.equal(url.pathname, "/api/v2/logs");
    assert.equal(url.searchParams.get("q"), 'type:f AND client_id:"app"');
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer management-token",
    );
  });
  await executeConnector({
    connectorId: "auth0",
    operationId: "logs",
    input: { query: 'type:f AND client_id:"app"', page: 2 },
    credentials: {
      baseUrl: "https://tenant.us.auth0.com",
      token: "management-token",
    },
  });
});

test("Twilio Monitor uses account basic auth and provider-specific pagination names", async () => {
  mockResponse({ alerts: [] }, (url, init) => {
    assert.equal(
      url.href,
      "https://monitor.twilio.com/v1/Alerts?PageSize=25&LogLevel=error&PageToken=next",
    );
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      `Basic ${Buffer.from("ACcustomer:auth-secret").toString("base64")}`,
    );
  });
  await executeConnector({
    connectorId: "twilio",
    operationId: "alerts",
    input: { logLevel: "error", pageToken: "next" },
    credentials: { accountSid: "ACcustomer", authToken: "auth-secret" },
  });
});

test("Snowflake query history submits only fixed diagnostic SQL and supports asynchronous results", async () => {
  const credentials = {
    baseUrl: "https://account.snowflakecomputing.com",
    token: "oauth-token",
    database: "APP",
    warehouse: "DIAGNOSTICS",
    role: "READER",
  };
  mockResponse(
    { statementHandle: "statement-id" },
    (url, init) => {
      assert.equal(url.pathname, "/api/v2/statements");
      const body = JSON.parse(String(init.body));
      assert.equal(body.database, "APP");
      assert.equal(body.role, "READER");
      assert.match(body.statement, /INFORMATION_SCHEMA.QUERY_HISTORY/);
      assert.match(body.statement, /RESULT_LIMIT => 10/);
      assert.equal(
        new Headers(init.headers).get("X-Snowflake-Authorization-Token-Type"),
        "OAUTH",
      );
    },
    202,
  );
  await executeConnector({
    connectorId: "snowflake",
    operationId: "query_history",
    input: { hours: 2, limit: 10 },
    credentials,
  });
  await assert.rejects(
    executeConnector({
      connectorId: "snowflake",
      operationId: "query_history",
      input: { query: "DROP TABLE accounts" },
      credentials,
    }),
    /Invalid input/,
  );
  mockResponse({ data: [] }, (url) => {
    assert.equal(url.pathname, "/api/v2/statements/statement-id");
    assert.equal(url.searchParams.get("partition"), "1");
  });
  await executeConnector({
    connectorId: "snowflake",
    operationId: "results",
    input: { statementHandle: "statement-id", partition: 1 },
    credentials,
  });
});

test("Atlas uses admin OAuth and versioned accept headers for configured project alerts", async () => {
  mockResponse({ results: [] }, (url, init) => {
    assert.equal(url.pathname, "/api/atlas/v2/groups/customer-project/alerts");
    assert.equal(url.searchParams.get("status"), "OPEN");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer atlas-oauth",
    );
    assert.equal(
      new Headers(init.headers).get("Accept"),
      "application/vnd.atlas.2025-03-12+json",
    );
  });
  await executeConnector({
    connectorId: "mongodb-atlas",
    operationId: "alerts",
    input: { status: "OPEN" },
    credentials: { token: "atlas-oauth", projectId: "customer-project" },
  });
});

test("Salesforce uses the SOQL read endpoint and never follows arbitrary pagination URLs", async () => {
  const credentials = {
    token: "sf-oauth",
    baseUrl: "https://customer.my.salesforce.com",
  };
  mockResponse({ records: [] }, (url, init) => {
    assert.equal(url.pathname, "/services/data/v66.0/query");
    assert.equal(url.searchParams.get("q"), "SELECT Id FROM Case LIMIT 25");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer sf-oauth",
    );
  });
  await executeConnector({
    connectorId: "salesforce",
    operationId: "query",
    input: { query: "SELECT Id FROM Case LIMIT 25" },
    credentials,
  });
  mockResponse({ records: [] }, (url) => {
    assert.equal(url.origin, "https://customer.my.salesforce.com");
    assert.equal(url.pathname, "/services/data/v66.0/query/cursor-2000");
  });
  await executeConnector({
    connectorId: "salesforce",
    operationId: "query_more",
    input: { locator: "cursor-2000" },
    credentials,
  });
});

test("Zendesk reads ticket comments with cursor pagination and OAuth", async () => {
  mockResponse({ comments: [], meta: { has_more: false } }, (url, init) => {
    assert.equal(url.pathname, "/api/v2/tickets/123/comments");
    assert.equal(url.searchParams.get("page[after]"), "cursor");
    assert.equal(url.searchParams.get("page[size]"), "25");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer zendesk-oauth",
    );
  });
  await executeConnector({
    connectorId: "zendesk",
    operationId: "comments",
    input: { ticketId: 123, after: "cursor" },
    credentials: {
      baseUrl: "https://customer.zendesk.com",
      token: "zendesk-oauth",
    },
  });
});
