import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AgentRelay } from "@agent-relay/sdk";

const baseUrl = "http://127.0.0.1:8787";
const relayFields = [
  "RELAY_BASE_URL",
  "RELAY_WORKSPACE_KEY",
  "RELAY_AGENT_TOKENS_JSON",
  "RELAY_NOTION_TOKEN",
  "RELAY_AWS_TOKEN",
  "RELAY_GOOGLE_TOKEN",
  "RELAY_NORTHSTAR_TOKEN",
  "RELAY_CONTOSO_TOKEN",
];

async function main() {
  let env = "";
  try {
    env = await readFile(".env", "utf8");
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(".janus", { recursive: true, mode: 0o700 });
  if (process.env.RELAY_WORKSPACE_KEY && process.env.RELAY_BASE_URL !== baseUrl) {
    const hosted = Object.fromEntries(
      relayFields.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []),
    );
    try {
      await writeFile(".janus/relay-hosted.json", JSON.stringify(hosted), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  let local: { workspaceKey: string; tokens: Record<string, string> };
  try {
    local = JSON.parse(await readFile(".janus/relay-local.json", "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const relay = await AgentRelay.createWorkspace({ name: `janus-local-${randomUUID()}`, baseUrl });
    const tokens: Record<string, string> = {};
    local = { workspaceKey: relay.workspaceKey!, tokens };
    await writeFile(".janus/relay-local.json", JSON.stringify(local), { mode: 0o600 });
    for (const organization of ["notion", "aws", "ramp", "google"]) {
      const agent = await relay.workspace.register(`janus-${organization}`);
      if (!agent.token) throw new Error("Relay registration did not return an agent token");
      tokens[organization] = agent.token;
      await writeFile(".janus/relay-local.json", JSON.stringify(local), { mode: 0o600 });
    }
  }
  const relay = new AgentRelay({ workspaceKey: local.workspaceKey, baseUrl });
  await relay.workspace.info();
  for (const organization of ["notion", "aws", "ramp", "google"]) {
    if (local.tokens[organization]) continue;
    const agent = await relay.workspace.register(`janus-${organization}`);
    if (!agent.token) throw new Error("Relay registration did not return an agent token");
    local.tokens[organization] = agent.token;
    await writeFile(".janus/relay-local.json", JSON.stringify(local), { mode: 0o600 });
  }
  const remaining = env.split(/\r?\n/).filter((line) =>
    !relayFields.some((key) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)),
  ).join("\n").trimEnd();
  await writeFile(".env", `${remaining}\nRELAY_BASE_URL=${baseUrl}\nRELAY_WORKSPACE_KEY=${local.workspaceKey}\nRELAY_AGENT_TOKENS_JSON=${JSON.stringify(local.tokens)}\n`, { mode: 0o600 });
  console.log("Local Agent Relay configured for Notion, AWS, Ramp, and Google Cloud. Restart the Janus API to use it.");
}

main().catch(() => {
  console.error("Local Agent Relay setup failed. Ensure pnpm relay:local is running on port 8787, then retry pnpm relay:setup.");
  process.exitCode = 1;
});
