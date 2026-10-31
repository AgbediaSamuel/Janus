# Janus

Janus connects the support agents on both sides of a B2B incident. Each organization investigates its own systems, exchanges evidence through Agent Relay, requests approved changes, and verifies recovery from the customer's side.

Built in TypeScript with pnpm, React, Deep Agents, Terse Durable Actors, Supabase, and Freestyle VMs. The console takes visual inspiration from o11 and Stripe. The agent architecture takes inspiration from Traverse's scoped tool factories and checkpointed execution; no Traverse application data or credentials are included.

## Run locally

Requires Node.js 22+ and pnpm 10.26.2.

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open the public landing page at the Vite URL, normally `http://127.0.0.1:5173`, then choose **Open Janus** to enter the Notion workspace. `/app` remains a shortcut to that workspace. The local workspace needs no login. The API listens on `127.0.0.1:4318`.

The four workspace entry points are defined in `src/workspaces.ts`:

| Organization | Workspace path |
| --- | --- |
| Notion | `/client/54d7c452-36a7-4f94-b37d-8b166e827001` |
| Ramp | `/client/54d7c452-36a7-4f94-b37d-8b166e827002` |
| AWS | `/vendor/54d7c452-36a7-4f94-b37d-8b166e827003` |
| Google Cloud | `/vendor/54d7c452-36a7-4f94-b37d-8b166e827004` |

Append `/cases`, `/integrations`, or `/network` for those views, or `/cases/<encoded-case-id>` for case details. Workspace URLs select the view; live Supabase membership still controls access.

Without credentials, Janus provides separate Notion, Ramp, AWS, and Google Cloud workspaces with four persisted cases: Notion attachment uploads and search indexing, plus Ramp receipt attachments and accounting exports. Customers see their own two cases; vendors see the cases involving them across both customers. The timeline includes private human correspondence and shared agent replies, with recovery approvals owned by the responsible organization. These are illustrative local incidents and fictional employees, not claims about the named companies' infrastructure. Connected sample integrations read scoped local records without provider calls or credentials. Backend `mode: simulation`, evidence `simulated: true`, and read-result `fixture: true` distinguish them from live access. Startup adds missing seeds and messages once while preserving progress. State persists in `.janus/`; real connector credentials entered locally remain in memory and must be entered again after restart. See [the demo guide](docs/demo.md) for the four recovery paths.

To use actual Terse persistence locally, run `pnpm dev:actors` in a second terminal and set `TERSE_ACTOR_URL=http://127.0.0.1:7100/v1/projects/janus/actors` before starting the API. Start a new case after switching storage modes. Terse becomes authoritative; `.janus/` keeps the local case index. The actor server needs no cloud account.


## Model-driven demo

The same case has an executable local service fixture. An attachment upload returns HTTP 503 while its tenant points to an unhealthy route and returns HTTP 200 after the vendor's approved rollback. The indexing scenario similarly restores a compatible consumer and drains the local backlog after customer approval. Agents have separate customer traces/probes and vendor rollout tools; the customer cannot inspect vendor configuration directly.

Configure `OPENAI_API_KEY`, `OPENAI_MODEL`, and `DATABASE_URL` for Deep Agents. Configure separate customer/vendor Agent Relay identities for actual cross-company messages. Creating a fresh case starts the configured investigator automatically; open **Conversation** to follow its progress and add human messages. Freestyle tools become available when `FREESTYLE_API_KEY` is set. All local fixture evidence retains `simulated: true` in the API, even when a real model investigates it.

`POST /api/demo/service/:caseId/checkout` exercises the fixture directly. Real Luna inference has passed the bounded `pnpm smoke:agent` experiment. The full bilateral investigation still requires PostgreSQL and Relay credentials; see [the demo guide](docs/demo.md).

## Connect the accounts

Ekene's provider-by-provider setup and scope checklist is in [docs/connectors.md](docs/connectors.md). Each catalog item has executable operations, input validation, credential fields, and documentation links. Account creation, token issuance, production permissions, and live provider validation are intentionally left to the operators.

Monitoring bridges can submit authenticated alerts to `POST /api/signals`. Janus opens one case per source incident, keeps the raw alert private, and schedules an investigation when the agent runtime is configured. See [the alert intake contract](docs/signals.md) for authentication, payloads, and duplicate handling.

For the platform:

1. Create a Supabase project and apply [the migration](supabase/migrations/202610310001_janus.sql).
2. Create Supabase Auth users. Add organizations and their membership rows using an administrative connection. Browser clients cannot grant themselves membership or read encrypted connector secrets.
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`.
4. Generate `JANUS_ENCRYPTION_KEY` with `openssl rand -base64 32`. Keep it in the worker's secret configuration. Connector secrets are encrypted with AES-256-GCM and bound to their organization.
5. Set `DATABASE_URL` to a direct or session-pooler Postgres connection for LangGraph checkpoints. Do not use a transaction pooler: per-case advisory locks require session affinity.
6. Deploy the Terse actor and configure `TERSE_ACTOR_URL` and any required `TERSE_API_KEY`. Provision Relay agents, then set `RELAY_WORKSPACE_KEY` and `RELAY_AGENT_TOKENS_JSON`.
7. Set `JANUS_MODE=live`. Live mode requires Supabase authentication and Terse storage; it does not silently fall back to demo data.

Example organization setup, after replacing the Auth user IDs:

```sql
insert into public.organizations (id, name, role, agent_name, deployment) values
  ('notion', 'Notion', 'Customer', 'Nova', 'hosted'),
  ('aws', 'AWS', 'Vendor', 'Atlas', 'self-hosted');
insert into public.organization_members (organization_id, user_id) values
  ('notion', '<customer-auth-user-uuid>'),
  ('aws', '<vendor-auth-user-uuid>');
```

## Runtime ownership

| Component               | Responsibility                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Terse                   | Authoritative live case state, evidence, pending runs, approvals, and event receipts                       |
| Deep Agents / LangGraph | Each organization's reasoning, scoped tools, private working context, and persistent execution checkpoints |
| Agent Relay             | Authenticated partner messages; Janus marks messages read after persistence; the SDK acknowledges transport delivery automatically |
| Supabase                | Auth, organization membership, case index, and encrypted connector configuration                           |
| Freestyle               | Organization-and-case-scoped reproduction VMs; production credentials are not copied into them             |
| React console           | Cases, evidence, timeline, integration configuration, and action review                                    |

Pending agent turns survive worker restarts. The checkpoint layer resumes unfinished graph work and recognizes completed turn IDs. External systems still determine their own operation semantics: a network failure after a write may leave its outcome uncertain. Janus records that condition for review and does not blindly replay the write.

Run one Janus API/worker replica per deployment for this version. The application queue is intentionally single-worker; per-graph Postgres locks and Terse version checks do not make the queue a distributed scheduler. The current hosted control plane manages both example organizations and enforces their access in the API. Fully separate company deployments, partner onboarding, and independent trust domains still require a federation design; the `deployment` label does not provision infrastructure.

Detailed setup, runtime interfaces, and verification notes: [server/runtime/README.md](server/runtime/README.md).

## Deployment

The Vercel configuration builds the frontend. Deploy the API/worker separately on a persistent host using the included Dockerfile or `pnpm start`. Set `HOST=0.0.0.0` only on the intended deployment host.

- Frontend: set `VITE_API_URL` to the API origin and the public Supabase client settings, then build/deploy on Vercel.
- Backend: set `JANUS_WEB_ORIGIN` to the exact frontend origin and configure the server-only secrets.
- Terse: deploy the actor separately or run its local development server for local testing.

Do not place service-role keys, model keys, provider credentials, or the encryption key in variables prefixed with `VITE_`.

## Checks

```sh
pnpm test
pnpm build
```

Tests cover connector request construction and failures, organization isolation, approval replay protection, credential encryption, Relay identity validation, actor versioning, and Deep Agents checkpoint replay with a fake test model. Provider mocks do not establish that live account scopes or endpoints are configured correctly. The Terse local runtime has also been exercised through actual HTTP calls across a server restart.

## Typography

The app uses Söhne through the project owner’s YC access, with a text-only Söhne semibold wordmark. Place the licensed webfont at `public/fonts/Sohne.woff2` before building or deploying. The font binary and local API keys are excluded from the public repository. See [font setup](public/fonts/README.md).
