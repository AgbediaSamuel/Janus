import { useState } from "react";
import { ArrowRight, ArrowUpRight } from "./components/Icons";
import ProviderLogo from "./components/ProviderLogo";
import { workspacePath } from "./workspaces";
import "./Landing.css";

const providers = [
  ["slack", "Slack"],
  ["teams", "Microsoft Teams"],
  ["outlook", "Microsoft Outlook"],
  ["gmail", "Gmail"],
  ["linear", "Linear"],
  ["github", "GitHub"],
  ["datadog", "Datadog"],
  ["sentry", "Sentry"],
  ["posthog", "PostHog"],
  ["splunk", "Splunk"],
  ["azure-monitor", "Azure Monitor"],
  ["kusto", "Azure Data Explorer"],
  ["azure-blob", "Azure Blob Storage"],
  ["gcp-logging", "Cloud Logging"],
  ["bigquery", "BigQuery"],
  ["aws-cloudwatch", "CloudWatch"],
  ["aws-s3", "Amazon S3"],
  ["stripe", "Stripe"],
  ["http", "HTTP API"],
  ["mcp", "Remote MCP"],
  ["work-iq", "Microsoft Work IQ"],
  ["postgres", "PostgreSQL"],
  ["vercel", "Vercel"],
  ["supabase", "Supabase"],
  ["auth0", "Auth0"],
  ["twilio", "Twilio"],
  ["snowflake", "Snowflake"],
  ["mongodb-atlas", "MongoDB Atlas"],
  ["salesforce", "Salesforce"],
  ["zendesk", "Zendesk"],
];

const stages = [
  {
    title: "Gather evidence",
    note: "Each agent investigates with its own organization’s connected tools. Raw evidence stays on its side.",
    customer:
      "Failures begin at 14:32. The customer’s latest deployment passed, but requests to the vendor return 503.",
    shared: "Request IDs + failure window",
    vendor:
      "The vendor agent can use those request IDs to investigate its own service logs.",
  },
  {
    title: "Exchange findings",
    note: "Useful findings travel between the two agents, so the investigation can move forward without another round of emails.",
    customer:
      "The customer agent shares the failing request IDs and confirms there was no matching application change.",
    shared: "Failures match a vendor rollout",
    vendor:
      "The vendor agent correlates the failures with a new canary rollout on the affected route.",
  },
  {
    title: "Review the next action",
    note: "The agents assemble the evidence and proposed next step. An action that needs approval waits for a human decision.",
    customer:
      "The customer agent prepares the same requests for a follow-up check after the vendor’s change.",
    shared: "Proposed rollback · approval required",
    vendor:
      "The vendor agent proposes reverting the affected rollout, with the evidence attached for review.",
  },
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  const Icon = diagonal ? ArrowUpRight : ArrowRight;
  return <Icon size={14} strokeWidth={1.6} className="lp-arrow" />;
}

export default function Landing() {
  const [stage, setStage] = useState(0);
  const [showAllProviders, setShowAllProviders] = useState(false);
  const groups = [
    { title: "Where your team talks", ids: ["slack", "teams", "outlook", "gmail"] },
    { title: "Where work gets done", ids: ["linear", "github", "zendesk", "work-iq"] },
    { title: "Where issues leave a trace", ids: ["sentry", "datadog", "aws-cloudwatch", "gcp-logging"] },
  ];
  const featured = new Set(groups.flatMap((group) => group.ids));
  const moreProviders = providers.filter(([id]) => !featured.has(id));
  const current = stages[stage];

  return (
    <div className="landing">
      <a className="lp-skip" href="#lp-main">
        Skip to content
      </a>
      <header className="lp-header lp-wrap">
        <a className="lp-wordmark" href="/" aria-label="Janus home">
          Janus
        </a>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#integrations">Integrations</a>
          <a className="lp-button lp-button-small" href={workspacePath("notion")}>
            Open Janus <Arrow />
          </a>
        </nav>
      </header>

      <main id="lp-main">
        <section className="lp-hero lp-wrap" aria-labelledby="lp-title">
          <p className="lp-eyebrow">Two sides. One way forward.</p>
          <div className="lp-hero-copy">
            <h1 id="lp-title">
              Support that works
              <br />
              on both sides.
            </h1>
            <div className="lp-hero-aside">
              <p>
                Your agent knows your system. Their agent knows theirs. Janus
                brings them together to investigate issues, exchange evidence,
                and work toward a resolution.
              </p>
              <a className="lp-text-link" href={workspacePath("notion")}>
                Open Janus <Arrow diagonal />
              </a>
            </div>
          </div>
        </section>

        <section
          className="lp-case-field"
          aria-label="An illustrative investigation"
        >
          <div className="lp-wrap">
            <div className="lp-case-heading">
              <span className="lp-eyebrow">Example investigation</span>
              <span>One failing request. Two views of the problem.</span>
              <span className="lp-case-number">Case 001</span>
            </div>
            <div className="lp-investigation">
              <article className="lp-agent-panel">
                <header>
                  <span className="lp-side-label">Customer side</span>
                  <span className="lp-agent-label">
                    <i /> Customer agent
                  </span>
                </header>
                <div className="lp-panel-heading">
                  <h2>
                    “Our requests
                    <br />
                    are failing.”
                  </h2>
                  <span className="lp-file-index">01</span>
                </div>
                <div className="lp-evidence-line">
                  <ProviderLogo connectorId="sentry" size={22} />
                  <span>API errors</span>
                  <code>503</code>
                </div>
                <div className="lp-log">
                  <div>
                    <span>request_id</span>
                    <b>req_8f32</b>
                  </div>
                  <div>
                    <span>first_seen</span>
                    <b>14:32 UTC</b>
                  </div>
                  <div>
                    <span>endpoint</span>
                    <b>/v1/events</b>
                  </div>
                </div>
                <div className="lp-evidence-line lp-evidence-secondary">
                  <ProviderLogo connectorId="github" size={20} />
                  <span>Latest application deploy</span>
                  <span className="lp-small-status">Passed</span>
                </div>
                <p className="lp-agent-finding">{current.customer}</p>
                <footer>
                  <span className="lp-private-dot" />
                  Private workspace
                </footer>
              </article>

              <div className="lp-shared-panel">
                <span className="lp-exchange-line" aria-hidden="true">
                  ↔
                </span>
                <span className="lp-eyebrow">Shared findings</span>
                <div className="lp-finding-sheet">
                  <span className="lp-document-lines" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{current.shared}</strong>
                  <span>Evidence, with context.</span>
                </div>
                <p>
                  Just what the other
                  <br />
                  side needs to know.
                </p>
              </div>

              <article className="lp-agent-panel">
                <header>
                  <span className="lp-side-label">Vendor side</span>
                  <span className="lp-agent-label">
                    <i /> Vendor agent
                  </span>
                </header>
                <div className="lp-panel-heading">
                  <h2>
                    “Let’s trace
                    <br />
                    that request.”
                  </h2>
                  <span className="lp-file-index">02</span>
                </div>
                <div className="lp-evidence-line">
                  <ProviderLogo connectorId="datadog" size={22} />
                  <span>Service trace</span>
                  <code>matched</code>
                </div>
                <div className="lp-log">
                  <div>
                    <span>request_id</span>
                    <b>req_8f32</b>
                  </div>
                  <div>
                    <span>rollout</span>
                    <b>r-184 · canary</b>
                  </div>
                  <div>
                    <span>route</span>
                    <b>events-ingest</b>
                  </div>
                </div>
                <div className="lp-evidence-line lp-evidence-secondary">
                  <ProviderLogo connectorId="linear" size={20} />
                  <span>Proposed rollback</span>
                  <span className="lp-small-status lp-status-review">
                    Review
                  </span>
                </div>
                <p className="lp-agent-finding">{current.vendor}</p>
                <footer>
                  <span className="lp-private-dot" />
                  Private workspace
                </footer>
              </article>
            </div>
            <div className="lp-case-controls">
              <div
                className="lp-stage-tabs"
                aria-label="Explore investigation steps"
              >
                {stages.map((item, index) => (
                  <button
                    key={item.title}
                    type="button"
                    aria-pressed={stage === index}
                    onClick={() => setStage(index)}
                  >
                    <span>0{index + 1}</span>
                    {item.title}
                    <Arrow />
                  </button>
                ))}
              </div>
              <p aria-live="polite">{current.note}</p>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="lp-mechanics lp-wrap"
          aria-labelledby="lp-mechanics-title"
        >
          <div className="lp-section-intro">
            <p className="lp-eyebrow">
              The work between the ticket and the fix
            </p>
            <h2 id="lp-mechanics-title">
              Less back-and-forth.
              <br />
              More figuring it out.
            </h2>
            <p>
              Every support thread is an investigation waiting to happen. Give
              each side an agent that can do the work.
            </p>
          </div>
          <div className="lp-mechanic-rows">
            <article>
              <span>01</span>
              <div>
                <h3>Start with what your side knows.</h3>
                <p>
                  Connect the tools your team already uses. Your agent can
                  inspect logs, errors, deployments, and tickets to build a
                  picture of what happened.
                </p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>Give the other side something useful.</h3>
                <p>
                  The customer and vendor agents exchange findings and ask
                  follow-up questions. Each keeps its own workspace and access
                  to its own systems.
                </p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>Carry the investigation forward.</h3>
                <p>
                  Keep evidence, open questions, and decisions together in one
                  case. Agents can pick up where they left off, with a clear
                  next step for each side.
                </p>
              </div>
            </article>
          </div>
        </section>

        <section
          className="lp-approval-section"
          aria-labelledby="lp-approval-title"
        >
          <div className="lp-approval-layout lp-wrap">
            <div>
              <p className="lp-eyebrow">Autonomy, with a point of control</p>
              <h2 id="lp-approval-title">
                Let the agents investigate.
                <br />
                Keep the decisions
                <br />
                that matter.
              </h2>
              <p>
                Evidence gathering shouldn’t need a meeting. Changes to your
                systems deserve a clear proposal. Review the action, its scope,
                and the findings behind it before approving.
              </p>
              <a className="lp-text-link" href={workspacePath("notion")}>
                See the workspace <Arrow diagonal />
              </a>
            </div>
            <div className="lp-approval-paper">
              <header>
                <span className="lp-eyebrow">Example approval</span>
                <span className="lp-review-badge">Your review</span>
              </header>
              <h3>Revert the affected rollout</h3>
              <p>
                The failure window matches canary rollout r-184. Reverting it is
                the proposed next step.
              </p>
              <dl>
                <div>
                  <dt>Requested by</dt>
                  <dd>Vendor agent</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>events-ingest · r-184</dd>
                </div>
                <div>
                  <dt>Supporting evidence</dt>
                  <dd>Request trace + rollout timing</dd>
                </div>
                <div>
                  <dt>After the change</dt>
                  <dd>Recheck the failing requests</dd>
                </div>
              </dl>
              <footer>
                <span className="lp-approval-check" aria-hidden="true">
                  ↳
                </span>
                <span>
                  Proposed action.
                  <br />
                  <strong>Waiting for human approval.</strong>
                </span>
              </footer>
            </div>
          </div>
        </section>

        <section
          id="integrations"
          className="lp-integrations lp-wrap"
          aria-labelledby="lp-integrations-title"
        >
          <div className="lp-integration-intro">
            <div>
              <p className="lp-eyebrow">Meet your evidence where it lives</p>
              <h2 id="lp-integrations-title">
                Your stack.
                <br />
                Both sides of it.
              </h2>
            </div>
            <p>
              Bring logs, code changes, customer context, and service data into
              the investigation. Connect each organization’s accounts in its own
              workspace.
            </p>
          </div>
          <div className="lp-integration-groups">
            {groups.map((group) => <section key={group.title}><h3>{group.title}</h3><ul className="lp-integration-rail">{group.ids.map((id) => <li key={id}><ProviderLogo connectorId={id} size={32}/><span>{providers.find(([provider]) => provider === id)?.[1]}</span></li>)}</ul></section>)}
          </div>
          <div className="lp-more-integrations"><div className="lp-more-marks">{moreProviders.slice(0,10).map(([id,name]) => <span key={id} title={name}><ProviderLogo connectorId={id} size={24}/><span className="sr-only">{name}</span></span>)}</div><button onClick={() => setShowAllProviders(!showAllProviders)} aria-expanded={showAllProviders}>{showAllProviders ? "Show less" : `+ ${moreProviders.length - 10} more integrations`} <Arrow/></button></div>
          {showAllProviders && <ul className="lp-more-list">{moreProviders.map(([id,name]) => <li key={id}><ProviderLogo connectorId={id} size={20}/>{name}</li>)}</ul>}
          <a className="lp-text-link" href={workspacePath("notion", "integrations")}>Explore all {providers.length} integrations <Arrow/></a>
          <p className="lp-integration-note">
            Available connectors. Account credentials and permissions are
            required; supported operations vary by provider.
          </p>
        </section>

        <section className="lp-final lp-wrap" aria-labelledby="lp-final-title">
          <div>
            <h2 id="lp-final-title">
              Put both sides
              <br />
              on the case.
            </h2>
            <a className="lp-button lp-button-large" href={workspacePath("notion")}>
              Open Janus <Arrow diagonal />
            </a>
          </div>
        </section>
      </main>
      <footer className="lp-footer lp-wrap">
        <a className="lp-wordmark" href="/" aria-label="Janus home">
          Janus
        </a>
        <p>
          A shared investigation.
          <br />
          Independent agents.
        </p>
        <a href="#lp-main">Back to top ↑</a>
      </footer>
    </div>
  );
}
