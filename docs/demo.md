# Janus demo

The demo should show a repaired service and the evidence behind it. The interface is the audience's view into that work.

## Two ways to run

**Guided replay** needs no accounts. Create a case, advance each stage, switch to Contoso Cloud to approve the rollback, then advance to the fixture's resolution. Use it to explore the case flow without credentials. It is explicitly simulated and does not run a model or contact providers.

**Agent investigation** runs Deep Agents against an executable local service. Start a fresh case; do not advance the guided replay. The customer can inspect traces, deployments, and checkout probes. The vendor can inspect rollout history and propose a routing rollback. The customer cannot call vendor tools.

Minimum setup for the model-driven demo:

- An OpenAI API key and a tool-capable model in `OPENAI_MODEL`.
- A direct or session-pooler PostgreSQL URL for checkpoints, for example from the Supabase project.
- Two separately registered Agent Relay identities, mapped to `northstar` and `contoso`, plus the workspace key.
- The local Terse actor server and `TERSE_ACTOR_URL` if demonstrating actual actor persistence.
- A Freestyle key when demonstrating VM reproduction tools. It is not required for the basic local service fault.

Use **Run agent investigation** as Northstar. The initial service returns 503. The customer investigates and sends the vendor a diagnostic request through Relay. Incoming messages start the recipient's next turn. The vendor discovers the unhealthy canary and proposes a rollback. Approve from the vendor workspace. After the action completes, the vendor agent resumes and can coordinate customer verification. A fresh customer probe returns 200; its recorded receipt is required to resolve the case.

Agents choose their own tool calls and messages. If one pauses for missing information, provide that information or start a focused follow-up from its workspace. Never substitute a guided step into an agent-driven case; the API rejects mixing those modes.

## Durability demonstration

Use the local Terse runtime and persistent PostgreSQL checkpoints. Restart only the Janus worker during an investigation, then reopen the case. The durable run retains its ID; pending graph work resumes and completed turns are not appended again. A write interrupted after its request may have an uncertain provider outcome and requires review; that is not an automatic retry demonstration.

Account-backed model inference, Relay delivery, and Freestyle provisioning must be rehearsed with the actual configured accounts before recording. The repository's automated tests exercise the same tool/case flow with a test investigator and local fixture, and test the Deep Agents checkpoint path with a fake model.
