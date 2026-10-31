import { z } from "zod";

export type Credentials = Record<string, string>;
export const text = z.string().trim().min(1);
export const pageSize = z.number().int().min(1).max(100).default(25);
export const record = z.record(z.string(), z.unknown());

export class ConnectorError extends Error {}

export function required(credentials: Credentials, key: string): string {
  const value = credentials[key];
  if (!value?.trim())
    throw new ConnectorError(`Missing credential field: ${key}`);
  return value;
}

export function endpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("Endpoint must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new ConnectorError(
      "Endpoint must use HTTPS without embedded credentials or fragments",
    );
  }
  return url;
}

export function base(credentials: Credentials, fallback?: string): URL {
  const url = endpoint(
    credentials.baseUrl || fallback || required(credentials, "baseUrl"),
  );
  if (url.search)
    throw new ConnectorError("Base URL must not contain query parameters");
  return url;
}

export function path(baseUrl: URL, suffix: string): URL {
  return new URL(
    `${baseUrl.href.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`,
  );
}

export function bearer(credentials: Credentials): Record<string, string> {
  return { Authorization: `Bearer ${required(credentials, "token")}` };
}

export async function request(
  url: URL | string,
  init: RequestInit = {},
  format: "json" | "text" | "ndjson" = "json",
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ConnectorError(
      "Provider request failed: check endpoint connectivity and credentials",
    );
  }
  if (!response.ok)
    throw new ConnectorError(`Provider returned HTTP ${response.status}`);
  const body = await response.text();
  if (!body) return null;
  if (format === "text") return body;
  try {
    if (format === "ndjson")
      return body
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    return JSON.parse(body);
  } catch {
    throw new ConnectorError("Provider returned an invalid response format");
  }
}

export function json(
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function segment(value: string): string {
  if (value === "." || value === "..")
    throw new ConnectorError("Invalid resource identifier");
  return encodeURIComponent(value);
}

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ConnectorError(
      `Invalid input: ${result.error.issues.map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`).join("; ")}`,
    );
  }
  return result.data;
}

export class ConnectorCredentialStore {
  private entries = new Map<string, Credentials>();
  set(
    organizationId: string,
    connectorId: string,
    credentials: Credentials,
  ): void {
    this.entries.set(JSON.stringify([organizationId, connectorId]), {
      ...credentials,
    });
  }
  get(organizationId: string, connectorId: string): Credentials {
    const credentials = this.entries.get(
      JSON.stringify([organizationId, connectorId]),
    );
    if (!credentials)
      throw new ConnectorError(
        "Connector credentials are not configured for this organization",
      );
    return { ...credentials };
  }
  delete(organizationId: string, connectorId: string): void {
    this.entries.delete(JSON.stringify([organizationId, connectorId]));
  }
}
