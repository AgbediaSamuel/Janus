# Janus

Technical support that works across companies.

When enterprise software breaks, the customer and vendor usually spend hours passing tickets, logs, and questions back and forth. Janus gives each side an agent that can investigate its own systems, ask the other side for evidence, and work toward a verified resolution. People can join the conversation where a decision or more context is needed.

## How it works

1. In the walkthrough, a monitoring agent reviews an incoming upload-failure signal and opens a support case.
2. The customer agent gathers traces, deployment history, and fresh service checks using its connected tools.
3. It sends a scoped diagnostic request to the vendor agent through Agent Relay.
4. The vendor agent investigates its own telemetry and configuration, then proposes a repair when the evidence supports one.
5. The responsible person reviews and approves the exact action.
6. The customer agent checks the affected service again before closing the case.

Each organization has its own workspace, private evidence, and agent context. Shared messages form a common case conversation. The timeline records tool activity, evidence, approvals, and verification so people can inspect how the agents reached a decision.

## What you can explore

- **Both sides of support:** separate customer and vendor views of the same incident.
- **Agent collaboration:** autonomous partner messages, evidence gathering, and follow-up turns.
- **Human participation:** message your own agent privately, address the partner agent, or contribute to the shared case.
- **Approval controls:** inspect a proposed action before it executes, then see its recorded result.
- **Connected tools:** adapters for cloud services, observability, collaboration, databases, and ticketing. The [connector guide](docs/connectors.md) lists supported operations and account requirements.

The walkthrough includes Notion and Ramp customer workspaces with AWS and Google Cloud vendor workspaces. These are example organizations. The included incidents run against isolated upload and indexing services, allowing an approved repair to change service behavior and a fresh probe to verify the result.

## Built with

| Component | Role in Janus |
| --- | --- |
| Agent Relay | Messages between customer and vendor agents that trigger recipient turns. |
| Terse Durable Actors | Case state, evidence, approvals, event receipts, and queued agent work. |
| Deep Agents / LangGraph | Tool-based investigations with separate organizational context and resumable checkpoints. |
| Supabase / PostgreSQL | Persistent agent checkpoints; authentication, memberships, and connector configuration in live mode. |
| React + Vite | Landing page, organization workspaces, case conversations, and evidence review. |
| TypeScript + Express | API, integrations, monitoring intake, and investigation worker. |
| Freestyle | Optional isolated reproduction workspaces when configured. |

## Run locally

Requires Node.js 22+ and pnpm 10.26.2.

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open **http://127.0.0.1:5173** and select **Open Janus**. The API runs on port **4318**. Example workspaces are available without signing in.

For model-driven investigations, configure these values in `.env`:

| Setting | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Tool-capable model for the agents. |
| `DATABASE_URL` | PostgreSQL connection for persistent checkpoints. Use a direct connection or session pooler. |
| `RELAY_WORKSPACE_KEY`, `RELAY_AGENT_TOKENS_JSON` | Agent Relay workspace and distinct identities for the participating organizations. |
| `TERSE_ACTOR_URL` | Terse actor endpoint for durable case state. |

To run the Terse actor locally, start `pnpm dev:actors` in another terminal and set `TERSE_ACTOR_URL=http://127.0.0.1:7100/v1/projects/janus/actors` before starting the API.

Open **`/admin`** to reset the walkthrough. With the agent runtime configured, reset introduces a fresh monitoring signal; the monitoring agent opens a new case and starts the investigation. The page provides links to the customer and vendor views. Each run starts with a fresh conversation.

Further setup: [runtime and deployment](server/runtime/README.md), [connectors](docs/connectors.md), and [monitoring intake](docs/signals.md).

## Checks

```sh
pnpm test
pnpm build
```

Tests cover organizational privacy, message delivery and receipt handling, approvals, connector requests, durable case state, monitoring intake, and checkpoint recovery.
