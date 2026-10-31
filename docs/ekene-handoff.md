# Janus handoff for Ekene

Ekene, we have the customer and vendor workspaces built now. The next priority is getting the recording through an actual agent investigation, not just clicking through the seeded cases. Please have your agent read this file and `docs/demo.md` before changing anything.

## Get it running

Repository: https://github.com/AgbediaSamuel/Janus — use the latest `main`.

```sh
git clone https://github.com/AgbediaSamuel/Janus.git
cd Janus
corepack enable
pnpm install --frozen-lockfile
```

The private handoff bundle contains `.env` and `.janus/supabase-ca.crt`. Copy both into the repository, preserving the `.janus` directory. The bundled database URL refers to the certificate relative to the repository; run commands from the repository root. Keep these files out of Git.

Start Terse in one terminal:

```sh
pnpm dev:actors
```

Then start the API and web app in another:

```sh
pnpm dev
```

Web: http://127.0.0.1:5173. API: http://127.0.0.1:4318. Terse: http://127.0.0.1:7100.

The app uses TypeScript throughout, React/Vite, Express, pnpm, Deep Agents, OpenAI, Supabase PostgreSQL checkpoints, Terse Durable Actors, and Agent Relay. It is not a Next.js app. There is no login gate in local demo mode; live mode has Supabase membership checks.

## Open the workspaces

| Workspace | URL path |
| --- | --- |
| Notion | `/client/54d7c452-36a7-4f94-b37d-8b166e827001` |
| Ramp | `/client/54d7c452-36a7-4f94-b37d-8b166e827002` |
| AWS | `/vendor/54d7c452-36a7-4f94-b37d-8b166e827003` |
| Google Cloud | `/vendor/54d7c452-36a7-4f94-b37d-8b166e827004` |
| Recording reset | `/admin` |

Append `/cases/<case-id>` to open the same investigation from either participant's view. Keep customer and vendor tabs open side by side. Each gets its own private messages, evidence, integrations, and approval controls. The vendor overview has a customer queue and internal findings. The customer view only has that customer's cases.

## The recording flow

The four original JAN-1041 through JAN-1044 cases contain seeded histories. They are useful for showing the interface and human conversations in Slack, Teams, Outlook, and Gmail. They are not proof of live agent messaging. Their conversation composer is read-only because mixing scripted progress with an autonomous run would corrupt the case state.

For real model interaction, create a **new case** in Notion with AWS as the vendor. Creating it starts the investigation automatically when the model/database configuration is present. Open its **Conversation** tab. Actual agent messages and working status appear there; the UI refreshes active cases every three seconds. There is no artificial typing animation or generated transcript playback.

Use **Message your agent** to add a private human message and queue a real agent turn. That message stays inside your organization. Agents can send sanitized summaries to the other party over Relay. The counterpart's next turn starts when its message is received. Full evidence and the trace remain in the Evidence and Timeline tabs.

The local incident service begins with a failing upload probe. Customer tools inspect requests and deployments; vendor tools inspect the unhealthy route. The vendor must request a repair, a human approves from the vendor view, and the actual local service route changes. A fresh successful customer probe is required before resolution. No real cloud resources, invoices, payments, or production services are changed by this scenario.

`/admin` restores the four seeded cases, evidence, approvals, and sample connections. It clears local case progress and in-memory provider credentials. It does not erase Supabase checkpoints, Relay history, external accounts, or `.env`. It refuses to reset while a run is pending/running. Wait for agents to finish first. Tests exercise reset on isolated data; don't reset Samuel's recording while he is using it.

## Credentials and integrations

The private `.env` includes the configured model, Supabase connection, and provisioned Relay identities. Do not paste the file into an agent's response or commit it. The database uses the session pooler, certificate verification, and the supplied CA. Do not disable TLS verification. Checkpoints have already been initialized.

We provide 30 credential-ready integration adapters. The connected badges in the initial workspaces are backed by scoped local fixtures, not authenticated Datadog, Slack, AWS, or Google accounts. Real account setup and connector credentials are still your part. Teams, Outlook, and Gmail currently accept operator-provided access tokens; full OAuth onboarding/token refresh is not implemented. Provider writes go through approvals.

Freestyle VM tools are implemented but need `FREESTYLE_API_KEY`. A VM is optional for the local incident demo. Don't let VM setup delay the core investigation.

Only run one Janus API worker against this shared Relay workspace while recording. Two local servers using the same identities can compete to consume inbox messages while their local case indexes differ. Coordinate with Samuel before starting the second worker, or provision a separate Relay workspace for your own rehearsal.

## Where the code lives

- `src/App.tsx`: customer/vendor workspace, case detail, approvals, new case flow.
- `src/components/CaseConversation.tsx`: actual case messages and private human composer.
- `src/components/CaseTimeline.tsx`: expandable trace and evidence links.
- `src/components/IntegrationCatalog.tsx`: connected/all integration views.
- `src/Landing.tsx`: public landing page and themed integration sections.
- `src/Admin.tsx`: local recording reset page.
- `src/workspaces.ts`: fixed company routes.
- `server/app.ts`: API, permissions, conversation, investigation, approvals, reset.
- `server/investigations.ts`: worker queue, agent tools, Relay receipt, completion.
- `server/agents/`: Deep Agents, OpenAI model, persistent checkpoints, optional VM tools.
- `server/runtime/`: Agent Relay transport, Terse actor, Freestyle adapter.
- `server/connectors/index.ts`: provider adapters.
- `server/demo-service.ts`: executable local fault, approved repair, verification probes.
- `server/store.ts`: case state and scoped connections; Terse is authoritative when configured.
- `server/fixtures.ts`: original seeded histories and correspondence.

## UI decisions to preserve

Janus is a text-only wordmark. Keep the light sidebar, restrained warm neutral colors, original provider logos, and the single top-bar collapse toggle. The company box is logo-first. The app must remain simple; the themed “where your team…” integration collections belong only on the landing page. The app has ordinary searchable Connected/All views.

Samuel has access to the Söhne fonts through YC. The local licensed font files are intentionally excluded from the public repository; see `public/fonts/README.md`. Obtain those files from Samuel's licensed copy for a visually identical recording. Don't replace the typography or download an unrelated font just to make the build pass.

## Before pushing or recording

```sh
pnpm build
pnpm test
```

Do a browser check of the conversation, human submission, approval, and fresh verification result. Keep credentials out of logs, screenshots, and commits. Don't claim actual Relay delivery, autonomous repair, or provider connectivity based only on a configured environment variable or a seeded timeline.

The key remaining proof is one complete real model-driven customer/vendor investigation through approval and verified recovery. Read the verification notes below for what was actually observed before this handoff.

## Verification notes

- A real Deep Agents/OpenAI turn collected local service traces, deployment data, and a fresh failed upload probe. It saved evidence, sent an actual Relay DM, and produced a visible reply in the Conversation tab.
- Supabase session-pooler connectivity and checkpoint table setup passed with certificate validation enabled.
- The recording worker is configured to use the local Terse actor server for case state.
- Notion, AWS, and Ramp have distinct Relay identities. Google registration has been returning Relay HTTP 503 (“database temporarily overloaded”); do not assume Google live messaging is configured.
- The conversation UI and /admin confirmation were inspected in the browser. Reset was tested on separate temporary local and Terse state, not against the active recording.
- Production build passes. The latest full test run before the Relay receiver adjustment had 84 passing tests.
- A receiver issue was found during rehearsal: the actual DM was created, but the SDK durable delivery inbox was empty. The receiver now uses token-scoped live DM listeners, and unread-history replay runs independently. Tests verify sender checks, persist-before-read, and processing live messages while history is stalled.

- Final checks: production build and all 87 automated tests pass.
- A human message was submitted through the actual browser composer and persisted privately with a queued model turn. The draft cleared only after the server accepted it.
- **Still unverified at handoff:** an actual AWS recipient turn and the complete bilateral repair. Relay history reads timed out and registration requests returned HTTP 503; the first Notion DM was sent, but the AWS turn was not observed. Do not describe that as a completed two-agent run. Start with this live transport check before recording.
- Rehearsal case on Samuel’s machine: `JAN-40A34A1B`, Notion/AWS. Its state is local to Samuel’s Terse server and is not included in the bundle. Create your own fresh case after coordinating which machine owns the Relay worker.

## First task for your coding agent

Read this handoff, inspect the current branch, run the checks, then verify a fresh Notion/AWS case. Confirm that a real Relay DM creates the recipient's shared event and queues its model turn. The current receiver uses the official SDK DM listener, not the empty durable-delivery inbox. Inspect provider errors without logging tokens. If Relay is overloaded, surface that status instead of inventing a reply or switching silently to a local fake transport. Once delivery works, demonstrate vendor approval, actual local service rollback, and a fresh successful customer probe. Preserve the UI and the organization privacy boundaries while fixing the transport.
