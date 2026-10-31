import { z } from "zod";
import type { ConnectorDefinition } from "../../src/types.js";
import {
  base,
  bearer,
  ConnectorError,
  endpoint,
  json,
  pageSize,
  parse,
  path,
  record,
  request,
  required,
  segment,
  text,
  type Credentials,
} from "./common.js";

export { ConnectorCredentialStore, ConnectorError } from "./common.js";
export type { Credentials } from "./common.js";

type Operation = ConnectorDefinition["operations"][number];
type Adapter = {
  definition: ConnectorDefinition;
  required: string[];
  run: (
    operation: string,
    input: Record<string, unknown>,
    credentials: Credentials,
  ) => Promise<unknown>;
};
const op = (
  id: string,
  name: string,
  exampleInput: Record<string, unknown>,
  write = false,
  description = name,
): Operation => ({ id, name, exampleInput, write, description });
const fields = (...keys: string[]): ConnectorDefinition["authFields"] =>
  keys.map((key) => ({
    key,
    label: key,
    secret: /token|key|secret|password|sas|connectionString/i.test(key),
  }));
const adapters: Adapter[] = [];
function add(
  id: string,
  name: string,
  category: ConnectorDefinition["category"],
  description: string,
  authFields: ConnectorDefinition["authFields"],
  requiredFields: string[],
  operations: Operation[],
  docsUrl: string,
  run: Adapter["run"],
): void {
  adapters.push({
    definition: {
      id,
      name,
      category,
      description,
      authFields,
      operations,
      docsUrl,
    },
    required: requiredFields,
    run,
  });
}

add(
  "slack",
  "Slack",
  "Collaboration",
  "Search messages, inspect threads, and post approved replies.",
  fields("token"),
  ["token"],
  [
    op("search", "Search messages", { query: "deployment error", limit: 25 }),
    op("replies", "Read thread", { channel: "C123", ts: "1234567890.123456" }),
    op(
      "post",
      "Post message",
      { channel: "C123", text: "Investigation update" },
      true,
    ),
  ],
  "https://docs.slack.dev/reference/methods/",
  async (operation, input, credentials) => {
    let result;
    if (operation === "search") {
      const data = parse(
        z
          .object({
            query: text,
            limit: pageSize,
            page: z.number().int().positive().default(1),
          })
          .strict(),
        input,
      );
      const url = new URL("https://slack.com/api/search.messages");
      url.search = new URLSearchParams({
        query: data.query,
        count: String(data.limit),
        page: String(data.page),
      }).toString();
      result = await request(url, { headers: bearer(credentials) });
    } else if (operation === "replies") {
      const data = parse(
        z
          .object({
            channel: text,
            ts: text,
            cursor: text.optional(),
            limit: pageSize,
          })
          .strict(),
        input,
      );
      const url = new URL("https://slack.com/api/conversations.replies");
      url.search = new URLSearchParams({
        channel: data.channel,
        ts: data.ts,
        limit: String(data.limit),
        ...(data.cursor ? { cursor: data.cursor } : {}),
      }).toString();
      result = await request(url, { headers: bearer(credentials) });
    } else {
      const data = parse(
        z.object({ channel: text, text, thread_ts: text.optional() }).strict(),
        input,
      );
      result = await request(
        "https://slack.com/api/chat.postMessage",
        json(data, bearer(credentials)),
      );
    }
    if (!result?.ok)
      throw new ConnectorError(
        "Slack rejected the request; check token scopes and channel access",
      );
    return result;
  },
);

function graphPage(collection: URL, nextPage?: string): URL {
  if (!nextPage) return collection;
  const next = endpoint(nextPage);
  if (next.origin !== collection.origin || next.pathname !== collection.pathname)
    throw new ConnectorError("Pagination must remain in the configured collection");
  return next;
}

const mailAddress = z.string().email();
const mailContent = z.object({
  to: z.array(mailAddress).min(1),
  subject: text.regex(/^[^\r\n]+$/, "Subject must be a single line"),
  text,
}).strict();

add(
  "teams", "Microsoft Teams", "Collaboration",
  "Read a configured Teams channel and its replies; send approved messages with delegated access.",
  fields("token", "teamId", "channelId"), ["token", "teamId", "channelId"],
  [
    op("messages", "List channel messages", { limit: 25 }),
    op("message", "Read channel message", { messageId: "message-id" }),
    op("replies", "Read message replies", { messageId: "message-id", limit: 25 }),
    op("post", "Post channel message", { text: "Investigation update" }, true),
    op("reply", "Reply to channel message", { messageId: "message-id", text: "Investigation update" }, true),
  ],
  "https://learn.microsoft.com/graph/api/channel-list-messages?view=graph-rest-1.0",
  async (operation, input, credentials) => {
    const collection = new URL(`https://graph.microsoft.com/v1.0/teams/${segment(required(credentials, "teamId"))}/channels/${segment(required(credentials, "channelId"))}/messages`);
    const headers = bearer(credentials);
    if (operation === "post" || operation === "reply") {
      const data = operation === "reply"
        ? parse(z.object({ messageId: text, text }).strict(), input)
        : parse(z.object({ text }).strict(), input);
      const url = "messageId" in data && typeof data.messageId === "string" ? path(collection, `${segment(data.messageId)}/replies`) : collection;
      return request(url, json({ body: { contentType: "text", content: data.text } }, headers));
    }
    if (operation === "message") {
      const data = parse(z.object({ messageId: text }).strict(), input);
      return request(path(collection, segment(data.messageId)), { headers });
    }
    const pagination = { limit: z.number().int().min(1).max(50).default(25), nextPage: text.optional() };
    const data = operation === "replies"
      ? parse(z.object({ messageId: text, ...pagination }).strict(), input)
      : parse(z.object(pagination).strict(), input);
    const url = "messageId" in data && typeof data.messageId === "string" ? path(collection, `${segment(data.messageId)}/replies`) : collection;
    url.searchParams.set("$top", String(data.limit));
    return request(graphPage(url, data.nextPage), { headers });
  },
);

add(
  "outlook", "Microsoft Outlook", "Collaboration",
  "Search a configured mailbox, read conversations, and send or reply after approval.",
  fields("token", "mailbox"), ["token", "mailbox"],
  [
    op("messages", "Search mailbox messages", { query: "subject:incident", limit: 25 }),
    op("message", "Read message", { messageId: "message-id" }),
    op("conversation", "Read conversation", { conversationId: "conversation-id", limit: 25 }),
    op("send", "Send email", { to: ["support@example.com"], subject: "Incident evidence", text: "Investigation update" }, true),
    op("reply", "Reply to sender", { messageId: "message-id", text: "Investigation update" }, true),
  ],
  "https://learn.microsoft.com/graph/api/user-list-messages?view=graph-rest-1.0",
  async (operation, input, credentials) => {
    const mailbox = required(credentials, "mailbox");
    const root = new URL(`https://graph.microsoft.com/v1.0/${mailbox === "me" ? "me" : `users/${segment(mailbox)}`}`);
    const collection = path(root, "messages");
    const headers = { ...bearer(credentials), Prefer: 'outlook.body-content-type="text"' };
    if (operation === "send") {
      const data = parse(mailContent, input);
      await request(path(root, "sendMail"), json({ message: {
        subject: data.subject, body: { contentType: "Text", content: data.text },
        toRecipients: data.to.map((address) => ({ emailAddress: { address } })),
      }, saveToSentItems: true }, headers));
      return { accepted: true, delivered: false };
    }
    if (operation === "reply") {
      const data = parse(z.object({ messageId: text, text }).strict(), input);
      await request(path(collection, `${segment(data.messageId)}/reply`), json({ message: { body: { contentType: "Text", content: data.text } } }, headers));
      return { accepted: true, delivered: false };
    }
    if (operation === "message") {
      const data = parse(z.object({ messageId: text }).strict(), input);
      return request(path(collection, segment(data.messageId)), { headers });
    }
    const pagination = { limit: pageSize, nextPage: text.optional() };
    const data = operation === "conversation"
      ? parse(z.object({ conversationId: text, ...pagination }).strict(), input)
      : parse(z.object({ query: text.optional(), ...pagination }).strict(), input);
    collection.searchParams.set("$top", String(data.limit));
    collection.searchParams.set("$select", "id,subject,from,toRecipients,receivedDateTime,sentDateTime,conversationId,body,bodyPreview,internetMessageId");
    if ("conversationId" in data) collection.searchParams.set("$filter", `conversationId eq '${data.conversationId.replace(/'/g, "''")}'`);
    if ("query" in data && data.query) collection.searchParams.set("$search", JSON.stringify(data.query));
    return request(graphPage(collection, data.nextPage), { headers });
  },
);

function safeMailHeader(value: unknown): string {
  if (typeof value !== "string" || /[\r\n]/.test(value))
    throw new ConnectorError("Provider returned an unsupported mail header");
  return value;
}

function singleMailRecipient(value: unknown): string {
  const header = safeMailHeader(value).trim();
  const named = header.match(/^[^<>]*<([^<>]+)>$/);
  const address = mailAddress.safeParse(named ? named[1] : header);
  if (!address.success) throw new ConnectorError("Reply requires one valid sender or Reply-To address");
  return address.data;
}

add(
  "gmail", "Gmail", "Collaboration",
  "Search the authenticated Gmail mailbox, read complete threads, and send approved email replies.",
  fields("token"), ["token"],
  [
    op("messages", "Search messages", { query: "subject:incident", limit: 25 }),
    op("threads", "Search threads", { query: "subject:incident", limit: 25 }),
    op("message", "Read message", { messageId: "message-id" }),
    op("thread", "Read thread and replies", { threadId: "thread-id" }),
    op("send", "Send email", { to: ["support@example.com"], subject: "Incident evidence", text: "Investigation update" }, true),
    op("reply", "Reply in thread", { messageId: "message-id", text: "Investigation update" }, true),
  ],
  "https://developers.google.com/workspace/gmail/api/reference/rest",
  async (operation, input, credentials) => {
    const root = new URL("https://gmail.googleapis.com/gmail/v1/users/me");
    const headers = bearer(credentials);
    if (operation === "messages" || operation === "threads") {
      const data = parse(z.object({ query: text.optional(), limit: pageSize, pageToken: text.optional() }).strict(), input);
      const url = path(root, operation);
      url.searchParams.set("maxResults", String(data.limit));
      if (data.query) url.searchParams.set("q", data.query);
      if (data.pageToken) url.searchParams.set("pageToken", data.pageToken);
      return request(url, { headers });
    }
    if (operation === "message" || operation === "thread") {
      const data = operation === "message"
        ? parse(z.object({ messageId: text }).strict(), input)
        : parse(z.object({ threadId: text }).strict(), input);
      const url = "messageId" in data ? path(root, `messages/${segment(data.messageId)}`) : path(root, `threads/${segment(data.threadId)}`);
      url.searchParams.set("format", "full");
      return request(url, { headers });
    }
    const data = operation === "send" ? parse(mailContent, input) : parse(z.object({ messageId: text, text }).strict(), input);
    let to: string[];
    let subject: string;
    let threadId: string | undefined;
    const threadHeaders: string[] = [];
    if ("messageId" in data) {
      const parentUrl = path(root, `messages/${segment(data.messageId)}`);
      parentUrl.searchParams.set("format", "metadata");
      const parent = await request(parentUrl, { headers });
      const header = (name: string) => parent.payload?.headers?.find((item: { name?: string; value?: string }) => item.name?.toLowerCase() === name)?.value;
      to = [singleMailRecipient(header("reply-to") || header("from"))];
      subject = safeMailHeader(header("subject") ?? "");
      const messageId = safeMailHeader(header("message-id"));
      if (!/^<[^<>\s]+>$/.test(messageId)) throw new ConnectorError("Reply requires a valid parent Message-ID header");
      const references = safeMailHeader(header("references") ?? "").trim();
      if (references && !/^(?:<[^<>\s]+>\s*)+$/.test(references)) throw new ConnectorError("Provider returned unsupported References header");
      threadId = parse(text, parent.threadId);
      threadHeaders.push(`In-Reply-To: ${messageId}`, `References: ${references ? `${references} ` : ""}${messageId}`);
    } else {
      to = data.to;
      subject = data.subject;
    }
    const profile = await request(path(root, "profile"), { headers });
    const from = singleMailRecipient(profile.emailAddress);
    const raw = [
      `From: ${from}`, `To: ${to.join(", ")}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      ...threadHeaders, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64", "", Buffer.from(data.text).toString("base64").match(/.{1,76}/g)!.join("\r\n"),
    ].join("\r\n");
    return request(path(root, "messages/send"), json({ raw: Buffer.from(raw).toString("base64url"), ...(threadId ? { threadId } : {}) }, headers));
  },
);

add(
  "linear",
  "Linear",
  "Collaboration",
  "Read team issues and create approved escalation tickets.",
  fields("token"),
  ["token"],
  [
    op("issues", "List team issues", { teamId: "team-uuid", limit: 25 }),
    op(
      "create",
      "Create issue",
      {
        teamId: "team-uuid",
        title: "Investigate delivery failures",
        description: "Evidence summary",
      },
      true,
    ),
  ],
  "https://linear.app/developers/graphql",
  async (operation, input, credentials) => {
    const headers = { Authorization: required(credentials, "token") };
    let body;
    if (operation === "issues") {
      const data = parse(
        z
          .object({ teamId: text, limit: pageSize, after: text.optional() })
          .strict(),
        input,
      );
      body = {
        query:
          "query($teamId: String!, $limit: Int!, $after: String) { team(id: $teamId) { issues(first: $limit, after: $after) { nodes { id identifier title description url updatedAt state { name } } pageInfo { hasNextPage endCursor } } } }",
        variables: data,
      };
    } else {
      const data = parse(
        z
          .object({ teamId: text, title: text, description: text.optional() })
          .strict(),
        input,
      );
      body = {
        query:
          "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }",
        variables: { input: data },
      };
    }
    const result = await request(
      "https://api.linear.app/graphql",
      json(body, headers),
    );
    if (result.errors || result.data?.issueCreate?.success === false)
      throw new ConnectorError(
        "Linear rejected the operation; check permissions and identifiers",
      );
    return result.data;
  },
);

add(
  "github",
  "GitHub",
  "Collaboration",
  "Inspect code changes, deployments, failed workflows, and repository issues.",
  fields("token", "owner", "repo"),
  ["token", "owner", "repo"],
  [
    op("issues", "List issues", { state: "open", limit: 25 }),
    op("issue", "Read issue", { number: 1 }),
    op(
      "create",
      "Create issue",
      { title: "Investigation", body: "Evidence" },
      true,
    ),
    op("commits", "List commits", { sha: "main", limit: 25 }),
    op("commit", "Read commit changes", { ref: "main" }),
    op("compare", "Compare revisions", {
      base: "previous-sha",
      head: "current-sha",
    }),
    op("deployments", "List deployments", { environment: "production" }),
    op("deployment_statuses", "Read deployment statuses", { deploymentId: 1 }),
    op("workflow_runs", "Find failed workflows", { status: "failure" }),
    op("workflow_jobs", "Read workflow job steps", { runId: 1 }),
  ],
  "https://docs.github.com/en/rest/issues/issues",
  async (operation, input, credentials) => {
    const root = `https://api.github.com/repos/${segment(credentials.owner)}/${segment(credentials.repo)}`;
    const url = new URL(`${root}/issues`);
    const headers = {
      ...bearer(credentials),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const pagination = {
      limit: pageSize,
      page: z.number().int().positive().default(1),
    };
    if (operation === "commits") {
      const data = parse(
        z
          .object({
            ...pagination,
            sha: text.optional(),
            since: z.iso.datetime().optional(),
            until: z.iso.datetime().optional(),
          })
          .strict(),
        input,
      );
      const target = new URL(`${root}/commits`);
      target.search = new URLSearchParams({
        per_page: String(data.limit),
        page: String(data.page),
        ...(data.sha ? { sha: data.sha } : {}),
        ...(data.since ? { since: data.since } : {}),
        ...(data.until ? { until: data.until } : {}),
      }).toString();
      return request(target, { headers });
    }
    if (operation === "commit" || operation === "compare") {
      const data =
        operation === "commit"
          ? parse(z.object({ ref: text, ...pagination }).strict(), input)
          : parse(
              z.object({ base: text, head: text, ...pagination }).strict(),
              input,
            );
      const target = new URL(
        "ref" in data
          ? `${root}/commits/${segment(data.ref)}`
          : `${root}/compare/${segment(data.base)}...${segment(data.head)}`,
      );
      target.search = new URLSearchParams({
        per_page: String(data.limit),
        page: String(data.page),
      }).toString();
      return request(target, { headers });
    }
    if (operation === "deployments" || operation === "workflow_runs") {
      const data =
        operation === "deployments"
          ? parse(
              z
                .object({
                  ...pagination,
                  environment: text.optional(),
                  sha: text.optional(),
                })
                .strict(),
              input,
            )
          : parse(
              z
                .object({
                  ...pagination,
                  status: z
                    .enum([
                      "failure",
                      "timed_out",
                      "cancelled",
                      "success",
                      "completed",
                      "in_progress",
                      "queued",
                    ])
                    .default("failure"),
                  branch: text.optional(),
                })
                .strict(),
              input,
            );
      const target = new URL(
        `${root}/${operation === "deployments" ? "deployments" : "actions/runs"}`,
      );
      target.searchParams.set("per_page", String(data.limit));
      target.searchParams.set("page", String(data.page));
      for (const [key, value] of Object.entries(data))
        if (key !== "limit" && key !== "page" && value !== undefined)
          target.searchParams.set(key, String(value));
      return request(target, { headers });
    }
    if (operation === "deployment_statuses" || operation === "workflow_jobs") {
      const data =
        operation === "deployment_statuses"
          ? parse(
              z
                .object({
                  deploymentId: z.number().int().positive(),
                  ...pagination,
                })
                .strict(),
              input,
            )
          : parse(
              z
                .object({ runId: z.number().int().positive(), ...pagination })
                .strict(),
              input,
            );
      const target = new URL(
        "deploymentId" in data
          ? `${root}/deployments/${data.deploymentId}/statuses`
          : `${root}/actions/runs/${data.runId}/jobs`,
      );
      target.search = new URLSearchParams({
        per_page: String(data.limit),
        page: String(data.page),
      }).toString();
      return request(target, { headers });
    }
    if (operation === "create") {
      const data = parse(
        z.object({ title: text, body: text.optional() }).strict(),
        input,
      );
      return request(url, json(data, headers));
    }
    if (operation === "issue") {
      const data = parse(
        z.object({ number: z.number().int().positive() }).strict(),
        input,
      );
      url.pathname += `/${data.number}`;
    } else {
      const data = parse(
        z
          .object({
            state: z.enum(["open", "closed", "all"]).default("open"),
            limit: pageSize,
            page: z.number().int().positive().default(1),
          })
          .strict(),
        input,
      );
      url.search = new URLSearchParams({
        state: data.state,
        per_page: String(data.limit),
        page: String(data.page),
      }).toString();
    }
    return request(url, { headers });
  },
);

add(
  "datadog",
  "Datadog",
  "Observability",
  "Search account logs with time bounds and cursor pagination.",
  fields("apiKey", "appKey", "site"),
  ["apiKey", "appKey"],
  [
    op("logs", "Search logs", {
      query: "status:error",
      from: "now-15m",
      to: "now",
      limit: 25,
    }),
  ],
  "https://docs.datadoghq.com/api/latest/logs/",
  async (_operation, input, credentials) => {
    const data = parse(
      z
        .object({
          query: text,
          from: text,
          to: text,
          limit: pageSize,
          cursor: text.optional(),
        })
        .strict(),
      input,
    );
    const site = credentials.site || "datadoghq.com";
    if (
      ![
        "datadoghq.com",
        "datadoghq.eu",
        "us3.datadoghq.com",
        "us5.datadoghq.com",
        "ap1.datadoghq.com",
        "ap2.datadoghq.com",
        "ddog-gov.com",
        "us2.ddog-gov.com",
        "uk1.datadoghq.com",
      ].includes(site)
    )
      throw new ConnectorError("Unsupported Datadog site");
    return request(
      `https://api.${site}/api/v2/logs/events/search`,
      json(
        {
          filter: { query: data.query, from: data.from, to: data.to },
          page: { limit: data.limit, cursor: data.cursor },
          sort: "-timestamp",
        },
        {
          "DD-API-KEY": credentials.apiKey,
          "DD-APPLICATION-KEY": credentials.appKey,
        },
      ),
    );
  },
);

add(
  "sentry",
  "Sentry",
  "Observability",
  "Read organization issues and their error events.",
  fields("token", "organization", "baseUrl"),
  ["token", "organization"],
  [
    op("issues", "Find issues", { query: "is:unresolved" }),
    op("events", "Read issue events", { issueId: "123" }),
  ],
  "https://docs.sentry.io/api/events/",
  async (operation, input, credentials) => {
    const root = base(credentials, "https://sentry.io");
    const data =
      operation === "issues"
        ? parse(
            z.object({ query: text, cursor: text.optional() }).strict(),
            input,
          )
        : parse(
            z.object({ issueId: text, cursor: text.optional() }).strict(),
            input,
          );
    const suffix =
      "query" in data
        ? `api/0/organizations/${segment(credentials.organization)}/issues/`
        : `api/0/issues/${segment(data.issueId)}/events/`;
    const url = path(root, suffix);
    if ("query" in data) url.searchParams.set("query", data.query);
    if (data.cursor) url.searchParams.set("cursor", data.cursor);
    return request(url, { headers: bearer(credentials) });
  },
);

add(
  "posthog",
  "PostHog",
  "Observability",
  "Query product events with HogQL.",
  fields("token", "projectId", "baseUrl"),
  ["token", "projectId"],
  [
    op("query", "Run HogQL query", {
      query: "SELECT event, timestamp FROM events LIMIT 25",
    }),
  ],
  "https://posthog.com/docs/api/query",
  async (_operation, input, credentials) => {
    const data = parse(z.object({ query: text }).strict(), input);
    return request(
      path(
        base(credentials, "https://us.posthog.com"),
        `api/projects/${segment(credentials.projectId)}/query/`,
      ),
      json(
        { query: { kind: "HogQLQuery", query: data.query } },
        bearer(credentials),
      ),
    );
  },
);

add(
  "splunk",
  "Splunk",
  "Observability",
  "Export matching events; this operation accepts search terms without SPL commands.",
  fields("token", "baseUrl"),
  ["token", "baseUrl"],
  [
    op("search", "Search events", {
      query: "index=main error",
      earliest: "-15m",
      latest: "now",
      limit: 25,
    }),
  ],
  "https://help.splunk.com/en/splunk-enterprise/rest-api-reference/9.2/search-endpoints/search-endpoint-descriptions",
  async (_operation, input, credentials) => {
    const data = parse(
      z
        .object({
          query: text.regex(
            /^[^|\[\]`\r\n]+$/,
            "Use search terms only; pipelines, subsearches and macros are not supported",
          ),
          earliest: text,
          latest: text,
          limit: pageSize,
        })
        .strict(),
      input,
    );
    return request(
      path(base(credentials), "services/search/jobs/export"),
      {
        method: "POST",
        headers: {
          ...bearer(credentials),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          search: `search ${data.query} | head ${data.limit}`,
          earliest_time: data.earliest,
          latest_time: data.latest,
          output_mode: "json",
          preview: "false",
        }),
      },
      "ndjson",
    );
  },
);

add(
  "azure-monitor",
  "Azure Monitor",
  "Observability",
  "Query a configured Log Analytics workspace.",
  fields("token", "workspaceId"),
  ["token", "workspaceId"],
  [
    op("query", "Query workspace logs", {
      query: "AzureActivity | take 25",
      timespan: "PT1H",
    }),
  ],
  "https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/request-format",
  async (_operation, input, credentials) => {
    const data = parse(
      z.object({ query: text, timespan: text }).strict(),
      input,
    );
    return request(
      `https://api.loganalytics.azure.com/v1/workspaces/${segment(credentials.workspaceId)}/query`,
      json(data, bearer(credentials)),
    );
  },
);

add(
  "kusto",
  "Azure Data Explorer",
  "Cloud & data",
  "Run KQL through the query endpoint, never the management endpoint.",
  fields("token", "baseUrl", "database"),
  ["token", "baseUrl", "database"],
  [op("query", "Run KQL query", { query: "StormEvents | take 25" })],
  "https://learn.microsoft.com/en-us/kusto/api/rest/request",
  async (_operation, input, credentials) => {
    const data = parse(z.object({ query: text }).strict(), input);
    return request(
      path(base(credentials), "v2/rest/query"),
      json(
        {
          db: credentials.database,
          csl: data.query,
          properties: JSON.stringify({
            Options: { queryconsistency: "strongconsistency" },
          }),
        },
        bearer(credentials),
      ),
    );
  },
);

add(
  "azure-blob",
  "Azure Blob Storage",
  "Cloud & data",
  "List or read blobs in a configured container with SAS or Entra credentials.",
  fields("baseUrl", "container", "sas", "token"),
  ["baseUrl", "container"],
  [
    op("list", "List blobs", { prefix: "logs/" }),
    op("read", "Read blob text", { name: "logs/error.txt" }),
  ],
  "https://learn.microsoft.com/en-us/rest/api/storageservices/list-blobs",
  async (operation, input, credentials) => {
    const data =
      operation === "list"
        ? parse(
            z
              .object({
                prefix: z.string().default(""),
                marker: text.optional(),
                limit: pageSize,
              })
              .strict(),
            input,
          )
        : parse(z.object({ name: text }).strict(), input);
    const root = path(base(credentials), segment(credentials.container));
    const url =
      "name" in data
        ? path(root, data.name.split("/").map(segment).join("/"))
        : root;
    if (credentials.sas) {
      for (const [key, value] of new URLSearchParams(
        credentials.sas.replace(/^\?/, ""),
      ))
        url.searchParams.set(key, value);
    }
    if ("prefix" in data) {
      url.searchParams.set("restype", "container");
      url.searchParams.set("comp", "list");
      url.searchParams.set("prefix", data.prefix);
      url.searchParams.set("maxresults", String(data.limit));
      if (data.marker) url.searchParams.set("marker", data.marker);
    }
    const headers: Record<string, string> = {
      "x-ms-version": "2023-11-03",
      "x-ms-date": new Date().toUTCString(),
    };
    if (!credentials.sas) Object.assign(headers, bearer(credentials));
    return {
      format: operation === "list" ? "xml" : "text",
      body: await request(url, { headers }, "text"),
    };
  },
);

add(
  "gcp-logging",
  "Google Cloud Logging",
  "Observability",
  "Read log entries from a configured GCP project.",
  fields("token", "projectId"),
  ["token", "projectId"],
  [op("logs", "Search log entries", { filter: "severity>=ERROR", limit: 25 })],
  "https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list",
  async (_operation, input, credentials) => {
    const data = parse(
      z
        .object({ filter: text, limit: pageSize, pageToken: text.optional() })
        .strict(),
      input,
    );
    return request(
      "https://logging.googleapis.com/v2/entries:list",
      json(
        {
          resourceNames: [`projects/${credentials.projectId}`],
          filter: data.filter,
          pageSize: data.limit,
          pageToken: data.pageToken,
          orderBy: "timestamp desc",
        },
        bearer(credentials),
      ),
    );
  },
);

add(
  "bigquery",
  "BigQuery",
  "Cloud & data",
  "Run explicitly approved SQL jobs or read their results.",
  fields("token", "projectId"),
  ["token", "projectId"],
  [
    op(
      "query",
      "Run SQL job",
      {
        query: "SELECT 1 AS healthy",
        maximumBytesBilled: "100000000",
        location: "US",
      },
      true,
      "Arbitrary SQL can mutate data; all query jobs require approval.",
    ),
    op("results", "Read query results", { jobId: "job-id", location: "US" }),
  ],
  "https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query",
  async (operation, input, credentials) => {
    const root = `https://bigquery.googleapis.com/bigquery/v2/projects/${segment(credentials.projectId)}`;
    if (operation === "query") {
      const data = parse(
        z
          .object({
            query: text,
            maximumBytesBilled: text.regex(/^\d+$/),
            location: text,
            dryRun: z.boolean().default(false),
          })
          .strict(),
        input,
      );
      return request(
        `${root}/queries`,
        json(
          { ...data, useLegacySql: false, timeoutMs: 10000, maxResults: 100 },
          bearer(credentials),
        ),
      );
    }
    const data = parse(
      z
        .object({ jobId: text, location: text, pageToken: text.optional() })
        .strict(),
      input,
    );
    const url = new URL(`${root}/queries/${segment(data.jobId)}`);
    url.searchParams.set("location", data.location);
    url.searchParams.set("maxResults", "100");
    if (data.pageToken) url.searchParams.set("pageToken", data.pageToken);
    return request(url, { headers: bearer(credentials) });
  },
);

function awsConfiguration(credentials: Credentials) {
  return {
    region: required(credentials, "region"),
    credentials: {
      accessKeyId: required(credentials, "accessKeyId"),
      secretAccessKey: required(credentials, "secretAccessKey"),
      ...(credentials.sessionToken
        ? { sessionToken: credentials.sessionToken }
        : {}),
    },
  };
}
const awsFields = fields(
  "region",
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
);
add(
  "aws-cloudwatch",
  "AWS CloudWatch Logs",
  "Observability",
  "Filter logs using organization-bound AWS credentials.",
  awsFields,
  ["region", "accessKeyId", "secretAccessKey"],
  [
    op("logs", "Filter log events", {
      logGroupName: "/aws/lambda/api",
      filterPattern: "ERROR",
      startTime: 0,
      limit: 25,
    }),
  ],
  "https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_FilterLogEvents.html",
  async (_operation, input, credentials) => {
    const data = parse(
      z
        .object({
          logGroupName: text,
          filterPattern: z.string().default(""),
          startTime: z.number().int().nonnegative(),
          endTime: z.number().int().nonnegative().optional(),
          limit: pageSize,
          nextToken: text.optional(),
        })
        .strict(),
      input,
    );
    const { CloudWatchLogsClient, FilterLogEventsCommand } = await import(
      "@aws-sdk/client-cloudwatch-logs"
    );
    const client = new CloudWatchLogsClient({
      ...awsConfiguration(credentials),
      maxAttempts: 1,
    });
    try {
      return await client.send(new FilterLogEventsCommand(data));
    } finally {
      client.destroy();
    }
  },
);

add(
  "aws-s3",
  "Amazon S3",
  "Cloud & data",
  "List objects or read text from an organization-bound bucket.",
  [...awsFields, ...fields("bucket")],
  ["region", "accessKeyId", "secretAccessKey", "bucket"],
  [
    op("list", "List objects", { prefix: "logs/" }),
    op("read", "Read object text", { key: "logs/error.txt" }),
  ],
  "https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html",
  async (operation, input, credentials) => {
    const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import(
      "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      ...awsConfiguration(credentials),
      maxAttempts: 1,
    });
    try {
      if (operation === "list") {
        const data = parse(
          z
            .object({
              prefix: z.string().default(""),
              continuationToken: text.optional(),
              limit: pageSize,
            })
            .strict(),
          input,
        );
        return await client.send(
          new ListObjectsV2Command({
            Bucket: credentials.bucket,
            Prefix: data.prefix,
            MaxKeys: data.limit,
            ContinuationToken: data.continuationToken,
          }),
        );
      }
      const data = parse(z.object({ key: text }).strict(), input);
      const result = await client.send(
        new GetObjectCommand({ Bucket: credentials.bucket, Key: data.key }),
      );
      return {
        contentType: result.ContentType,
        etag: result.ETag,
        body: await result.Body?.transformToString(),
      };
    } finally {
      client.destroy();
    }
  },
);

add(
  "stripe",
  "Stripe",
  "Cloud & data",
  "Inspect payment state and webhook events without moving money.",
  fields("token"),
  ["token"],
  [
    op("payment", "Read PaymentIntent", { id: "pi_example" }),
    op("events", "List events", {
      type: "payment_intent.succeeded",
      deliverySuccess: false,
      limit: 25,
    }),
  ],
  "https://docs.stripe.com/api/events/list",
  async (operation, input, credentials) => {
    if (operation === "payment") {
      const data = parse(
        z.object({ id: text.regex(/^pi_[a-zA-Z0-9_]+$/) }).strict(),
        input,
      );
      return request(`https://api.stripe.com/v1/payment_intents/${data.id}`, {
        headers: bearer(credentials),
      });
    }
    const data = parse(
      z
        .object({
          type: text.optional(),
          deliverySuccess: z.boolean().optional(),
          startingAfter: text.optional(),
          limit: pageSize,
        })
        .strict(),
      input,
    );
    const url = new URL("https://api.stripe.com/v1/events");
    url.searchParams.set("limit", String(data.limit));
    if (data.type) url.searchParams.set("type", data.type);
    if (data.deliverySuccess !== undefined)
      url.searchParams.set("delivery_success", String(data.deliverySuccess));
    if (data.startingAfter)
      url.searchParams.set("starting_after", data.startingAfter);
    return request(url, { headers: bearer(credentials) });
  },
);

add(
  "http",
  "HTTP API",
  "Extensibility",
  "Call a configured HTTPS endpoint; every request requires explicit approval.",
  fields("baseUrl", "token"),
  ["baseUrl"],
  [op("request", "Call endpoint", { method: "GET", path: "health" }, true)],
  "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
  async (_operation, input, credentials) => {
    const data = parse(
      z
        .object({
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
          path: z.string(),
          body: record.optional(),
        })
        .strict(),
      input,
    );
    const root = base(credentials);
    const url = new URL(data.path, `${root.href.replace(/\/$/, "")}/`);
    if (
      url.origin !== root.origin ||
      !url.pathname.startsWith(`${root.pathname.replace(/\/$/, "")}/`) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new ConnectorError(
        "Request path must remain inside the configured endpoint",
      );
    if (data.method === "GET" && data.body)
      throw new ConnectorError("GET requests cannot include a body");
    return request(url, {
      method: data.method,
      headers: {
        ...(credentials.token ? bearer(credentials) : {}),
        "Content-Type": "application/json",
      },
      ...(data.body ? { body: JSON.stringify(data.body) } : {}),
    });
  },
);

for (const [id, name, docsUrl] of [
  ["mcp", "Remote MCP", "https://ts.sdk.modelcontextprotocol.io/client"],
  [
    "work-iq",
    "Microsoft Work IQ",
    "https://learn.microsoft.com/microsoft-365/copilot/extensibility/work-iq/mcp/overview",
  ],
]) {
  add(
    id,
    name,
    "Extensibility",
    "Discover and call remote Streamable HTTP tools; tool calls require approval.",
    fields("baseUrl", "token"),
    ["baseUrl"],
    [
      op("list_tools", "Discover tools", {}),
      op("call_tool", "Call tool", { name: "tool_name", arguments: {} }, true),
    ],
    docsUrl,
    async (operation, input, credentials) => {
      const data =
        operation === "list_tools"
          ? parse(z.object({ cursor: text.optional() }).strict(), input)
          : parse(
              z.object({ name: text, arguments: record.default({}) }).strict(),
              input,
            );
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );
      const client = new Client({ name: "janus", version: "0.1.0" });
      const transport = new StreamableHTTPClientTransport(
        endpoint(credentials.baseUrl),
        {
          requestInit: {
            headers: credentials.token ? bearer(credentials) : {},
            redirect: "error",
          },
        },
      );
      try {
        await client.connect(transport);
        return "name" in data
          ? await client.callTool(data)
          : await client.listTools(data);
      } finally {
        await client.close();
      }
    },
  );
}

add(
  "postgres",
  "PostgreSQL",
  "Cloud & data",
  "Run a query inside a read-only transaction using a dedicated database role.",
  fields("connectionString"),
  ["connectionString"],
  [
    op("query", "Read database", {
      query: "SELECT current_database()",
      parameters: [],
    }),
  ],
  "https://www.postgresql.org/docs/current/sql-set-transaction.html",
  async (_operation, input, credentials) => {
    const data = parse(
      z
        .object({
          query: text,
          parameters: z
            .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .default([]),
        })
        .strict(),
      input,
    );
    const { Client } = await import("pg");
    const client = new Client({
      connectionString: credentials.connectionString,
      statement_timeout: 15000,
      connectionTimeoutMillis: 10000,
    });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      const result = await client.query({
        name: "janus-read-query",
        text: data.query,
        values: data.parameters,
      });
      await client.query("ROLLBACK");
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        fields: result.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        })),
      };
    } finally {
      await client.end();
    }
  },
);

add(
  "vercel",
  "Vercel",
  "Cloud & data",
  "Inspect deployment state, source revision, and build events.",
  fields("token", "teamId"),
  ["token"],
  [
    op("deployment", "Read deployment", { deploymentId: "dpl_example" }),
    op("build_events", "Read build events", {
      deploymentId: "dpl_example",
      limit: 25,
    }),
  ],
  "https://vercel.com/docs/rest-api/deployments/get-deployment-events",
  async (operation, input, credentials) => {
    const data =
      operation === "deployment"
        ? parse(z.object({ deploymentId: text }).strict(), input)
        : parse(
            z
              .object({
                deploymentId: text,
                limit: pageSize,
                since: z.number().int().nonnegative().optional(),
                until: z.number().int().nonnegative().optional(),
              })
              .strict(),
            input,
          );
    const url = new URL(
      operation === "deployment"
        ? `https://api.vercel.com/v13/deployments/${segment(data.deploymentId)}`
        : `https://api.vercel.com/v3/deployments/${segment(data.deploymentId)}/events`,
    );
    if (credentials.teamId) url.searchParams.set("teamId", credentials.teamId);
    if ("limit" in data) {
      url.searchParams.set("limit", String(data.limit));
      url.searchParams.set("follow", "0");
      url.searchParams.set("direction", "backward");
      if ("since" in data && data.since !== undefined)
        url.searchParams.set("since", String(data.since));
      if ("until" in data && data.until !== undefined)
        url.searchParams.set("until", String(data.until));
    } else url.searchParams.set("withGitRepoInfo", "true");
    return request(url, { headers: bearer(credentials) });
  },
);

add(
  "supabase",
  "Supabase Management",
  "Cloud & data",
  "Read project service health and unified service logs.",
  fields("token", "projectRef"),
  ["token", "projectRef"],
  [
    op("health", "Read service health", {
      services: ["auth", "rest", "realtime", "storage"],
    }),
    op("logs", "Read project logs", {
      from: "2026-10-31T10:00:00Z",
      to: "2026-10-31T11:00:00Z",
    }),
  ],
  "https://supabase.com/docs/reference/api/v1-get-project-logs",
  async (operation, input, credentials) => {
    const root = `https://api.supabase.com/v1/projects/${segment(credentials.projectRef)}`;
    if (operation === "health") {
      const data = parse(
        z.object({ services: z.array(text).min(1) }).strict(),
        input,
      );
      const url = new URL(`${root}/health`);
      url.searchParams.set("services", data.services.join(","));
      return request(url, { headers: bearer(credentials) });
    }
    const data = parse(
      z
        .object({ from: z.iso.datetime(), to: z.iso.datetime() })
        .strict()
        .refine(
          (value) =>
            Date.parse(value.to) > Date.parse(value.from) &&
            Date.parse(value.to) - Date.parse(value.from) <= 86_400_000,
          "Log range must be positive and no longer than 24 hours",
        ),
      input,
    );
    const url = new URL(`${root}/analytics/endpoints/logs`);
    url.search = new URLSearchParams({
      iso_timestamp_start: data.from,
      iso_timestamp_end: data.to,
    }).toString();
    return request(url, { headers: bearer(credentials) });
  },
);

add(
  "auth0",
  "Auth0",
  "Observability",
  "Search tenant authentication logs and inspect individual failures.",
  fields("baseUrl", "token"),
  ["baseUrl", "token"],
  [
    op("logs", "Search authentication logs", { query: "type:f", limit: 25 }),
    op("log", "Read authentication log", { logId: "log-id" }),
  ],
  "https://auth0.com/docs/deploy-monitor/logs/retrieve-log-events-using-mgmt-api",
  async (operation, input, credentials) => {
    if (operation === "log") {
      const data = parse(z.object({ logId: text }).strict(), input);
      return request(
        path(base(credentials), `api/v2/logs/${segment(data.logId)}`),
        { headers: bearer(credentials) },
      );
    }
    const data = parse(
      z
        .object({
          query: text,
          limit: pageSize,
          page: z.number().int().nonnegative().default(0),
        })
        .strict(),
      input,
    );
    const url = path(base(credentials), "api/v2/logs");
    url.search = new URLSearchParams({
      q: data.query,
      per_page: String(data.limit),
      page: String(data.page),
      sort: "date:-1",
      include_totals: "true",
    }).toString();
    return request(url, { headers: bearer(credentials) });
  },
);

add(
  "twilio",
  "Twilio",
  "Observability",
  "Inspect Monitor alerts and failed webhook request/response details.",
  fields("accountSid", "authToken"),
  ["accountSid", "authToken"],
  [
    op("alerts", "List alerts", { logLevel: "error", limit: 25 }),
    op("alert", "Read alert details", {
      alertSid: "NO00000000000000000000000000000000",
    }),
  ],
  "https://www.twilio.com/docs/usage/monitor-alert",
  async (operation, input, credentials) => {
    const headers = {
      Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`,
    };
    if (operation === "alert") {
      const data = parse(
        z.object({ alertSid: text.regex(/^NO[0-9a-fA-F]{32}$/) }).strict(),
        input,
      );
      return request(`https://monitor.twilio.com/v1/Alerts/${data.alertSid}`, {
        headers,
      });
    }
    const data = parse(
      z
        .object({
          logLevel: z.enum(["error", "warning", "notice", "debug"]).optional(),
          startDate: z.iso.datetime().optional(),
          endDate: z.iso.datetime().optional(),
          limit: pageSize,
          pageToken: text.optional(),
        })
        .strict(),
      input,
    );
    const url = new URL("https://monitor.twilio.com/v1/Alerts");
    url.searchParams.set("PageSize", String(data.limit));
    if (data.logLevel) url.searchParams.set("LogLevel", data.logLevel);
    if (data.startDate) url.searchParams.set("StartDate", data.startDate);
    if (data.endDate) url.searchParams.set("EndDate", data.endDate);
    if (data.pageToken) url.searchParams.set("PageToken", data.pageToken);
    return request(url, { headers });
  },
);

add(
  "snowflake",
  "Snowflake",
  "Cloud & data",
  "Inspect recent query history with fixed diagnostic SQL and read async results.",
  fields("baseUrl", "token", "database", "warehouse", "role"),
  ["baseUrl", "token", "database", "warehouse", "role"],
  [
    op("query_history", "Read recent query history", { hours: 1, limit: 25 }),
    op("results", "Read statement result", {
      statementHandle: "statement-uuid",
      partition: 0,
    }),
  ],
  "https://docs.snowflake.com/en/developer-guide/sql-api/submitting-requests",
  async (operation, input, credentials) => {
    const headers = {
      ...bearer(credentials),
      "X-Snowflake-Authorization-Token-Type": "OAUTH",
      "User-Agent": "Janus/0.1.0",
      Accept: "application/json",
    };
    const root = path(base(credentials), "api/v2/statements");
    if (operation === "results") {
      const data = parse(
        z
          .object({
            statementHandle: text,
            partition: z.number().int().nonnegative().default(0),
          })
          .strict(),
        input,
      );
      const url = path(root, segment(data.statementHandle));
      url.searchParams.set("partition", String(data.partition));
      return request(url, { headers });
    }
    const data = parse(
      z
        .object({
          hours: z.number().int().min(1).max(168).default(1),
          limit: pageSize,
        })
        .strict(),
      input,
    );
    const statement = `SELECT QUERY_ID, QUERY_TEXT, EXECUTION_STATUS, ERROR_CODE, ERROR_MESSAGE, START_TIME, END_TIME, TOTAL_ELAPSED_TIME, WAREHOUSE_NAME FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY(END_TIME_RANGE_START => DATEADD('hour', -${data.hours}, CURRENT_TIMESTAMP()), RESULT_LIMIT => ${data.limit})) ORDER BY START_TIME DESC`;
    return request(
      root,
      json(
        {
          statement,
          database: credentials.database,
          warehouse: credentials.warehouse,
          role: credentials.role,
          timeout: 15,
        },
        headers,
      ),
    );
  },
);

add(
  "mongodb-atlas",
  "MongoDB Atlas",
  "Cloud & data",
  "Read project alerts through the Atlas administration API.",
  fields("token", "projectId"),
  ["token", "projectId"],
  [op("alerts", "Read project alerts", { status: "OPEN", limit: 25 })],
  "https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupalerts",
  async (_operation, input, credentials) => {
    const data = parse(
      z
        .object({
          status: z.enum(["OPEN", "TRACKING", "CLOSED"]).optional(),
          limit: pageSize,
          page: z.number().int().positive().default(1),
        })
        .strict(),
      input,
    );
    const url = new URL(
      `https://cloud.mongodb.com/api/atlas/v2/groups/${segment(credentials.projectId)}/alerts`,
    );
    url.search = new URLSearchParams({
      itemsPerPage: String(data.limit),
      pageNum: String(data.page),
      ...(data.status ? { status: data.status } : {}),
    }).toString();
    return request(url, {
      headers: {
        ...bearer(credentials),
        Accept: "application/vnd.atlas.2025-03-12+json",
      },
    });
  },
);

add(
  "salesforce",
  "Salesforce",
  "Cloud & data",
  "Read authorized records using SOQL and retrieve further result pages.",
  fields("baseUrl", "token", "apiVersion"),
  ["baseUrl", "token"],
  [
    op("query", "Query records", {
      query: "SELECT Id, CaseNumber, Status, Subject FROM Case LIMIT 25",
    }),
    op("query_more", "Read next result page", { locator: "query-locator" }),
  ],
  "https://developer.salesforce.com/docs/platform/api-rest/guide/resources-query",
  async (operation, input, credentials) => {
    const version = credentials.apiVersion || "v66.0";
    if (!/^v\d+\.0$/.test(version))
      throw new ConnectorError(
        "Salesforce apiVersion must have the form v66.0",
      );
    const root = path(base(credentials), `services/data/${version}/query`);
    if (operation === "query_more") {
      const data = parse(z.object({ locator: text }).strict(), input);
      return request(path(root, segment(data.locator)), {
        headers: bearer(credentials),
      });
    }
    const data = parse(z.object({ query: text }).strict(), input);
    root.searchParams.set("q", data.query);
    return request(root, { headers: bearer(credentials) });
  },
);

add(
  "zendesk",
  "Zendesk",
  "Collaboration",
  "Read support tickets and public/private comment threads.",
  fields("baseUrl", "token"),
  ["baseUrl", "token"],
  [
    op("ticket", "Read ticket", { ticketId: 1 }),
    op("comments", "Read ticket comments", { ticketId: 1, limit: 25 }),
  ],
  "https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/",
  async (operation, input, credentials) => {
    const data =
      operation === "ticket"
        ? parse(
            z.object({ ticketId: z.number().int().positive() }).strict(),
            input,
          )
        : parse(
            z
              .object({
                ticketId: z.number().int().positive(),
                limit: pageSize,
                after: text.optional(),
              })
              .strict(),
            input,
          );
    const url = path(
      base(credentials),
      `api/v2/tickets/${data.ticketId}${operation === "comments" ? "/comments" : ""}`,
    );
    if ("limit" in data) {
      url.searchParams.set("page[size]", String(data.limit));
      if ("after" in data && typeof data.after === "string")
        url.searchParams.set("page[after]", data.after);
    }
    return request(url, { headers: bearer(credentials) });
  },
);

export const connectorDefinitions: ConnectorDefinition[] = adapters.map(
  (adapter) => adapter.definition,
);

export function validateCredentials(
  connectorId: string,
  credentials: Credentials,
): void {
  const adapter = adapters.find((item) => item.definition.id === connectorId);
  if (!adapter) throw new ConnectorError("Unknown connector");
  for (const key of adapter.required) required(credentials, key);
  if (credentials.baseUrl) endpoint(credentials.baseUrl);
  if (connectorId === "azure-blob" && !credentials.sas && !credentials.token)
    throw new ConnectorError("Azure Blob requires sas or token");
}

export async function executeConnector(options: {
  connectorId: string;
  operationId: string;
  input: Record<string, unknown>;
  credentials: Credentials;
}): Promise<unknown> {
  const adapter = adapters.find(
    (item) => item.definition.id === options.connectorId,
  );
  if (!adapter) throw new ConnectorError("Unknown connector");
  if (
    !adapter.definition.operations.some(
      (operation) => operation.id === options.operationId,
    )
  )
    throw new ConnectorError("Unknown connector operation");
  validateCredentials(options.connectorId, options.credentials);
  try {
    return await adapter.run(
      options.operationId,
      options.input,
      options.credentials,
    );
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError(
      "Provider operation failed; check credentials, permissions and input",
    );
  }
}
