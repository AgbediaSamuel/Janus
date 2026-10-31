# Janus demo

The demo should show a repaired service and the evidence behind it. The interface is the audience's view into that work.

## Two ways to run

**Seeded cases** need no accounts. The default Notion workspace contains JAN-1042, an AWS S3 upload incident at the investigation stage, and JAN-1041, a Google Cloud search-indexing incident awaiting Notion approval. Continue JAN-1042 to the AWS-owned route-restoration approval, approve from AWS, then continue to verify an upload. For JAN-1041, approve the Notion-owned indexing replay and continue to verify search freshness. Both are persisted local fixtures: ordinary case copy is shown in the console while `mode: simulation` and `simulated: true` remain in the backend. Neither flow contacts a provider or claims a verified connection. Reopening or restarting preserves approved and resolved cases. Existing user cases are retained; older workspace records remain on disk.

**Agent investigation** runs Deep Agents against an executable local service. Start a fresh case; do not advance the guided replay. The customer can inspect traces, deployments, and upload or search-freshness probes. The vendor can inspect rollout history and propose a routing rollback. The customer cannot call vendor tools.

Minimum setup for the model-driven demo:

- An OpenAI API key and a tool-capable model in `OPENAI_MODEL`.
- A direct or session-pooler PostgreSQL URL for checkpoints, for example from the Supabase project.
- Two separately registered Agent Relay identities, mapped to `notion` and `aws`, plus the workspace key.
- The local Terse actor server and `TERSE_ACTOR_URL` if demonstrating actual actor persistence.
- A Freestyle key when demonstrating VM reproduction tools. It is not required for the basic local service fault.

As Notion, open **Investigation details → Use connected agents** on a fresh case. The initial service returns 503. The customer investigates and sends the vendor a diagnostic request through Relay. Incoming messages start the recipient's next turn. The vendor discovers the unhealthy canary and proposes a rollback. Approve from the vendor workspace. After the action completes, the vendor agent resumes and can coordinate customer verification. A fresh customer probe returns 200; its recorded receipt is required to resolve the case.

Agents choose their own tool calls and messages. If one pauses for missing information, provide that information or start a focused follow-up from its workspace. Never substitute a guided step into an agent-driven case; the API rejects mixing those modes.

## Durability demonstration

Use the local Terse runtime and persistent PostgreSQL checkpoints. Restart only the Janus worker during an investigation, then reopen the case. The durable run retains its ID; pending graph work resumes and completed turns are not appended again. A write interrupted after its request may have an uncertain provider outcome and requires review; that is not an automatic retry demonstration.

Account-backed model inference, Relay delivery, and Freestyle provisioning must be rehearsed with the actual configured accounts before recording. The repository's automated tests exercise the same tool/case flow with a test investigator and local fixture, and test the Deep Agents checkpoint path with a fake model.

## Bounded model smoke

Run `pnpm smoke:agent` with `OPENAI_API_KEY` in your local `.env`. The example model is `gpt-6-luna`; `OPENAI_MODEL` remains explicit and configurable. The investigator uses the Responses API with low reasoning effort, as described in the [official Luna documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

This executes a real Deep Agents graph with the shared investigation tool schemas and isolated in-memory fixtures. It checks that the agent reads the case, collects evidence, proposes the exact route repair, and concludes `waiting` with a pending approval. No repair is executed. The terminal prints tool names, status, and token usage; it does not print model prose, credentials, or raw API errors. Tracing is disabled for this command.

The smoke has a 20-step graph limit, an eight-call model limit, 1,000 output tokens per response, a two-minute timeout, and no model retries. These are experiment budget choices, not production limits. Relay, filesystem tools, and delegation are unavailable. The smoke does not require PostgreSQL, Terse, Freestyle, connected provider accounts, or the running Janus API.

Observed with the configured local account: the smoke passed through `read_case → collect_evidence → add_evidence → request_action → conclude_investigation`. Six model responses consumed 14,273 input tokens and 443 output tokens. The final state was `waiting`, the approval stayed `pending`, and there were zero production writes and zero Relay calls.

## What still needs to be demonstrated

| Proof | Observed | Required for a complete recording |
| --- | --- | --- |
| Model chooses and executes tools | Real Luna inference and shared tool callbacks passed against the isolated smoke fixture. | Run the complete case through the Janus worker. |
| Cross-company Agent Relay exchange | Automated transport tests exist; the smoke deliberately makes no Relay calls. | Deliver a message between two configured Relay identities and show the recipient resume. |
| Terse durability | The local actor and Store wrapper were checked through a process restart with the saved case retained. | Show the worker resume the same case and run ID with PostgreSQL checkpoints. |
| Approval followed by verification | Automated local-fixture tests cover approval and fresh-probe resolution; the model smoke stops at pending approval. | Approve the model-proposed action, execute it, and collect a fresh successful probe before claiming resolution. |

The successful smoke establishes model access and a bounded tool/approval turn. It does not establish a deployed bilateral investigation, provider-account connectivity, or a repaired production incident.
