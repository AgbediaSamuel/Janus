# Janus runtime

`createInvestigator` in `server/agents/index.ts` uses Deep Agents 1.16.2 and an OpenAI chat model. Set `OPENAI_API_KEY`, `OPENAI_MODEL`, and `DATABASE_URL`. It requires persistent PostgreSQL checkpoints; there is no live in-memory fallback. The model must support tool calling. `invoke(message, turnId)` returns `{threadId, text}`; pass the durable case run ID. `close()` releases the checkpoint pool.

Tool callbacks are bound by the case service to an authenticated organization and case. The model cannot select another organization or case. The default Deep Agents filesystem is virtual checkpoint state, not the host filesystem. Terse owns case state, action approvals, and the case timeline; LangGraph owns each organization's private agent conversation and scratch files. A PostgreSQL session advisory lock serializes graph turns for the same organization and case. Use a direct or session-pool PostgreSQL connection for `DATABASE_URL`; transaction-pool proxies do not preserve session advisory locks.

On retry, pending graph nodes resume with `invoke(null)`. A persisted input message with the same turn ID is not appended again. Graph checkpoints do not make external tool calls exactly once: a process can die after a remote operation but before checkpointing its result. Connector writes therefore remain separately approved case actions, and Relay message handlers must deduplicate before acknowledgement.

## Terse actor

Run from the repository root:

```sh
pnpm dlx bun server/runtime/actor/dev.ts
```

Bun 1.4.2+ is required by the Terse runtime. The command downloads the Terse native runtime on its first run. Set the application's `TERSE_ACTOR_URL` to `http://127.0.0.1:7100/v1/projects/janus/actors`. Local development has no authentication. Keep `.durable-actors/` on persistent storage and out of git. `TERSE_PORT` and `TERSE_DATA_DIR` override the launcher's port and storage path.

`readTerseCase(caseId)` returns `{version, snapshot}`. `persistTerseCase({caseId,eventId,expectedVersion,snapshot})` rejects stale writers and event IDs replayed with different payloads. An identical replay returns its original event version without overwriting newer state. The actor uses standard TypeScript decorators and serialized methods; do not enable legacy decorators or interleaved execution for commits.

For hosted deployment, use the Terse CLI with `server/runtime/actor/src/actor.ts` as the actor entrypoint and the repository as the project. Provision a Terse project, deploy the actor, and use the actor URL returned by that deployment plus `TERSE_API_KEY`. The source and adapter are implemented; hosted deployment and credentials are operator configuration. The local server was verified by committing state, stopping the server, restarting it, reading the retained snapshot, and replaying the event successfully.

## Agent Relay

Set `RELAY_WORKSPACE_KEY` and `RELAY_AGENT_TOKENS_JSON`, a JSON object mapping Janus organization IDs to separately provisioned Relay agent tokens. `RELAY_NOTION_TOKEN`, `RELAY_AWS_TOKEN`, and `RELAY_GOOGLE_TOKEN` are aliases for the local organizations. The older Northstar/Contoso environment aliases remain supported for existing installations. `RELAY_BASE_URL` optionally changes the Relay endpoint. Agents must already be registered; reconnecting does not create or rename agents.

`sendRelayMessage({caseId,eventId,from,to,text})` sends an actual direct message with a stable idempotency key. Distinct organizations have distinct authenticated Relay agent identities. Receivers use a token-scoped SDK `addListener("dm.received")`, validate the authenticated sender and case metadata, persist the incoming case event, then mark the actual message read. The case service deduplicates by message identity before queueing the recipient's next turn.

Startup unread DM history uses `inbox.get` and `messages.listDirect`. It runs independently of live events so a slow provider history request cannot block new messages. A history failure is reported and leaves the live listener active. The provider's durable-delivery ledger was empty for observed ordinary DMs, so this transport does not rely on `inbox.list` or claim durable-delivery acknowledgements. Case-scoped receive uses the same authenticated unread-message reader.

## Freestyle

Set `FREESTYLE_API_KEY` to enable the agent's workspace tools. `FREESTYLE_SNAPSHOT_ID` optionally selects the initial image. The current package is `freestyle`, not the deprecated `freestyle-sandboxes` package.

`createFreestyleWorkspace({organizationId,caseId})` provides `create`, `execute`, `start`, and `pause`. Each workspace has a deterministic scoped slug and ownership metadata checked before every operation. Create returns an existing matching VM when present. The default firewall permits outbound public Internet for reproductions and package installation; callers can pass a specific firewall configuration. No production credentials are injected. Execution returns actual stdout, stderr, and statusCode; nonzero or null status is not success. Workspace files and memory persist while paused; infrastructure remains billed according to Freestyle's policy. The adapter does not silently delete VMs.

## Verified interfaces

- [Deep Agents TypeScript quickstart](https://docs.langchain.com/oss/javascript/deepagents/quickstart)
- [LangGraph PostgreSQL persistence](https://docs.langchain.com/oss/javascript/langgraph/add-memory)
- [OpenAI API authentication setup](https://developers.openai.com/api/docs/quickstart)
- [Terse quickstart and deployment](https://docs.useterse.ai/quickstart)
- [Agent Relay SDK 15.0.1](https://www.npmjs.com/package/@agent-relay/sdk/v/15.0.1); transport signatures were checked against its published TypeScript declarations and implementation.
- [Freestyle VM SDK quickstart](https://www.freestyle.sh/docs/quickstart)

Configuration status reports only whether environment values are present. It does not assert that authentication, model access, or external infrastructure has been verified. Relay, model inference, PostgreSQL, and Freestyle need configured accounts for live end-to-end verification.
