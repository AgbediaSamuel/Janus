import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Connection, Organization, SupportCase } from "../src/types";
import { liveMode, supabaseAdmin, HttpError } from "./config";
import { decryptCredentials, encryptCredentials } from "./secrets";
import { persistTerseCase, readTerseCase } from "./runtime/terse";

import { localOrganizations, seededCases } from "./fixtures";

interface Data {
  cases: SupportCase[];
  connections: Connection[];
}
const empty = (): Data => ({ cases: [], connections: [] });

export class Store {
  private data = empty();
  private credentials = new Map<string, Record<string, string>>();
  private queue: Promise<unknown> = Promise.resolve();
  private file = path.resolve(
    process.env.JANUS_DATA_DIR || ".janus",
    "state.json",
  );

  async initialize() {
    if (liveMode) return;
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8"));
      this.data.connections = this.data.connections.map((connection) => ({
        ...connection,
        status: "not_configured",
        message:
          "Credentials are held locally in memory. Reconnect after a server restart.",
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const item of seededCases().reverse()) {
      const existing = this.data.cases.find(
        (candidate) => candidate.id === item.id,
      );
      if (process.env.TERSE_ACTOR_URL) {
        const persisted = await readTerseCase(item.id);
        if (persisted.snapshot) {
          if (!existing) {
            this.data.cases.unshift(persisted.snapshot);
            await this.save();
          }
          continue;
        }
        if (existing) {
          await persistTerseCase({
            caseId: existing.id,
            eventId: `create:${existing.id}`,
            expectedVersion: 0,
            snapshot: existing,
          });
          continue;
        }
      }
      if (!existing) await this.createCase(item);
    }
  }

  serialized<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.data), {
      mode: 0o600,
    });
    await rename(`${this.file}.tmp`, this.file);
  }

  async organizations(ids?: string[]): Promise<Organization[]> {
    if (!liveMode)
      return ids
        ? localOrganizations.filter((organization) =>
            ids.includes(organization.id),
          )
        : localOrganizations;
    const query = supabaseAdmin().from("organizations").select("*");
    const { data, error } = await (ids ? query.in("id", ids) : query);
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      agentName: row.agent_name,
      deployment: row.deployment,
    }));
  }

  async listCases(): Promise<SupportCase[]> {
    if (!liveMode) {
      if (!process.env.TERSE_ACTOR_URL) return structuredClone(this.data.cases);
      const cases = await Promise.all(
        this.data.cases.map((item) => this.getCase(item.id)),
      );
      return cases.filter((item): item is SupportCase => item !== null);
    }
    const { data, error } = await supabaseAdmin()
      .from("support_cases")
      .select("id");
    if (error) throw error;
    const cases = await Promise.all(
      (data || []).map((row) => this.getCase(row.id)),
    );
    return cases.filter((item): item is SupportCase => item !== null);
  }

  async getCase(id: string): Promise<SupportCase | null> {
    if (!liveMode && !process.env.TERSE_ACTOR_URL)
      return structuredClone(
        this.data.cases.find((item) => item.id === id) || null,
      );
    return (await readTerseCase(id)).snapshot;
  }

  async createCase(item: SupportCase) {
    return this.serialized(async () => {
      if (liveMode) {
        const { error } = await supabaseAdmin().from("support_cases").insert({
          id: item.id,
          customer_id: item.customerId,
          vendor_id: item.vendorId,
        });
        if (error) throw error;
        await persistTerseCase({
          caseId: item.id,
          eventId: `create:${item.id}`,
          expectedVersion: 0,
          snapshot: item,
        });
      } else {
        if (process.env.TERSE_ACTOR_URL)
          await persistTerseCase({
            caseId: item.id,
            eventId: `create:${item.id}`,
            expectedVersion: 0,
            snapshot: item,
          });
        this.data.cases.unshift(structuredClone(item));
        await this.save();
      }
      return item;
    });
  }

  async updateCase(
    id: string,
    fn: (item: SupportCase) => void | Promise<void>,
  ) {
    return this.serialized(async () => {
      const useActor = liveMode || Boolean(process.env.TERSE_ACTOR_URL);
      const current = useActor
        ? await readTerseCase(id)
        : { version: 0, snapshot: await this.getCase(id) };
      if (!current.snapshot) throw new HttpError(404, "Case not found");
      const item = current.snapshot;
      await fn(item);
      item.updatedAt = new Date().toISOString();
      if (useActor) {
        await persistTerseCase({
          caseId: id,
          eventId: crypto.randomUUID(),
          expectedVersion: current.version,
          snapshot: item,
        });
      }
      if (!liveMode) {
        this.data.cases[this.data.cases.findIndex((value) => value.id === id)] =
          item;
        await this.save();
      }
      return structuredClone(item);
    });
  }

  async listConnections(): Promise<Connection[]> {
    if (!liveMode) return structuredClone(this.data.connections);
    const { data, error } = await supabaseAdmin()
      .from("connections")
      .select("id,organization_id,connector_id,status,last_checked,message");
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      connectorId: row.connector_id,
      mode: "live",
      status: row.status,
      lastChecked: row.last_checked,
      message: row.message,
    }));
  }

  async setConnection(
    connection: Connection,
    credentials?: Record<string, string>,
  ) {
    return this.serialized(async () => {
      if (liveMode) {
        const row = {
          id: connection.id,
          organization_id: connection.organizationId,
          connector_id: connection.connectorId,
          status: connection.status,
          last_checked: connection.lastChecked,
          message: connection.message,
          ...(credentials
            ? {
                encrypted_credentials: encryptCredentials(
                  credentials,
                  connection.organizationId,
                ),
              }
            : {}),
        };
        const { error } = await supabaseAdmin()
          .from("connections")
          .upsert(row, { onConflict: "id" });
        if (error) throw error;
      } else {
        this.data.connections = this.data.connections
          .filter((item) => item.id !== connection.id)
          .concat(connection);
        if (credentials)
          this.credentials.set(connection.id, { ...credentials });
        await this.save();
      }
      return connection;
    });
  }

  async getCredentials(
    connection: Connection,
  ): Promise<Record<string, string>> {
    if (!liveMode) {
      const credentials = this.credentials.get(connection.id);
      if (!credentials)
        throw new HttpError(
          400,
          "Reconnect this integration; demo credentials are not persisted.",
        );
      return { ...credentials };
    }
    const { data, error } = await supabaseAdmin()
      .from("connections")
      .select("encrypted_credentials")
      .eq("id", connection.id)
      .eq("organization_id", connection.organizationId)
      .single();
    if (error) throw error;
    return decryptCredentials(
      data.encrypted_credentials,
      connection.organizationId,
    );
  }

  async reset() {
    if (liveMode)
      throw new HttpError(403, "Reset is available only in demo mode");
    return this.serialized(async () => {
      const cases = await this.listCases();
      if (
        cases.some((item) =>
          item.runs?.some((run) => ["pending", "running"].includes(run.status)),
        )
      ) {
        throw new HttpError(
          409,
          "Wait for pending investigations to finish before resetting the demo",
        );
      }
      this.data = empty();
      this.credentials.clear();
      await this.save();
    });
  }
}
