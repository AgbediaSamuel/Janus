import type { Connection, ConnectorDefinition, Evidence, Organization, SupportCase } from "../types";
import ProviderLogo from "./ProviderLogo";
import { ArrowRight, ChevronRight, LockKeyhole } from "./Icons";
import "./VendorOperations.css";

export default function VendorOperations({ cases, organizations, organizationId, connections, connectors, onCase, onEvidence, onConnector }: {
  cases: SupportCase[];
  organizations: Organization[];
  organizationId: string;
  connections: Connection[];
  connectors: ConnectorDefinition[];
  onCase: (id: string) => void;
  onEvidence: (evidence: Evidence) => void;
  onConnector: (connector: ConnectorDefinition) => void;
}) {
  const open = cases.filter((item) => !["resolved", "escalated"].includes(item.status));
  const customerCount = new Set(open.map((item) => item.customerId)).size;
  const privateFindings = cases.flatMap((item) => item.evidence.filter((entry) => entry.organizationId === organizationId && entry.visibility === "private").map((evidence) => ({ evidence, caseTitle: item.title }))).slice(-4);
  return <div className="vendor-operations">
    <section className="vendor-queue panel">
      <header><div><h2>Customer queue</h2><p>{open.length} open cases across {customerCount} customers</p></div><span className="vendor-queue-count">{open.length}</span></header>
      {cases.map((item) => {
        const customer = organizations.find((org) => org.id === item.customerId);
        const pending = item.approvals.find((approval) => approval.status === "pending");
        const next = pending ? pending.organizationId === organizationId ? "Your approval needed" : `Waiting for ${customer?.name}` : item.status === "awaiting_approval" ? `Waiting for ${customer?.name}` : item.status === "resolved" ? "Resolved" : item.status === "verifying" ? "Verifying recovery" : "Investigation in progress";
        return <button className="vendor-case" key={item.id} onClick={() => onCase(item.id)}>
          <div className="vendor-case-customer"><ProviderLogo connectorId={item.customerId} size={25}/><strong>{customer?.name || item.customerId}</strong><span>{item.id}</span></div>
          <h3>{item.title}</h3><p>{item.summary}</p><div className="vendor-case-next"><span className={`vendor-next-dot ${item.status}`}/>{next}<ArrowRight size={14}/></div>
        </button>;
      })}
      {!cases.length && <p className="vendor-empty">Customer investigations will appear here.</p>}
    </section>
    <aside className="vendor-context">
      <section className="panel vendor-private"><header><h2>Internal findings</h2><span><LockKeyhole size={12}/> Only your team</span></header>
        {privateFindings.map(({ evidence, caseTitle }) => <button key={evidence.id} onClick={() => onEvidence(evidence)}><span>{evidence.source}</span><strong>{evidence.title}</strong><p>{caseTitle}</p><ChevronRight size={14}/></button>)}
        {!privateFindings.length && <p className="vendor-empty">Your agent’s internal diagnostics will appear here.</p>}
      </section>
      <section className="panel vendor-tools"><header><h2>Your support stack</h2></header>{connections.filter((item) => item.status === "connected").map((connection) => {
        const connector = connectors.find((item) => item.id === connection.connectorId);
        return connector && <button key={connection.id} onClick={() => onConnector(connector)}><ProviderLogo connectorId={connector.id} size={22}/><span>{connector.name}</span><span className="vendor-tool-connected">Connected</span></button>;
      })}</section>
    </aside>
  </div>;
}
