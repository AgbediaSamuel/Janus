import { useState } from "react";
import type { Connection, ConnectorDefinition } from "../types";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Search,
  X,
} from "./Icons";
import ProviderLogo from "./ProviderLogo";
import "./IntegrationCatalog.css";

interface IntegrationCatalogProps {
  connectors: ConnectorDefinition[];
  connections: Connection[];
  onSelect: (connector: ConnectorDefinition) => void;
  organizationName: string;
}

function CatalogCard({
  connector,
  connection,
  onSelect,
}: {
  connector: ConnectorDefinition;
  connection?: Connection;
  onSelect: (connector: ConnectorDefinition) => void;
}) {
  const connected = connection?.status === "connected";
  return (
    <button
      type="button"
      className="catalog-connection"
      onClick={() => onSelect(connector)}
    >
      <span className="catalog-connection-top">
        <ProviderLogo connectorId={connector.id} size={30} />
        <ArrowUpRight size={15} />
      </span>
      <strong>{connector.name}</strong>
      <span className="catalog-connection-description">
        {connector.description}
      </span>
      <span
        className={`catalog-connection-state ${connected ? "connected" : connection?.status === "error" ? "attention" : ""}`}
      >
        {connected ? (
          <>
            <Check size={12} />
            Connected
          </>
        ) : connection?.status === "error" ? (
          "Needs attention"
        ) : connection ? (
          "Not connected"
        ) : (
          "Connect"
        )}
      </span>
    </button>
  );
}

export default function IntegrationCatalog({
  connectors,
  connections,
  onSelect,
  organizationName,
}: IntegrationCatalogProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"all" | "connected">("connected");
  const connectedIDs = new Set(
    connections
      .filter((item) => item.status === "connected")
      .map((item) => item.connectorId),
  );
  const matches = connectors.filter(
    (connector) =>
      `${connector.name} ${connector.description} ${connector.category}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (view !== "connected" || connectedIDs.has(connector.id)),
  );
  return (
    <div className="integration-catalog">
      <div className="catalog-browse-bar">
        <label className="catalog-search">
          <Search size={16} />
          <input
            aria-label="Search integrations"
            placeholder="Find an integration…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear integration search"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="catalog-view-options" aria-label="Browse integrations">
          <button
            type="button"
            aria-pressed={view === "all"}
            onClick={() => setView("all")}
          >
            All <span>{connectors.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === "connected"}
            onClick={() => setView("connected")}
          >
            Connected <span>{connectedIDs.size}</span>
          </button>
        </div>
      </div>
      <div className="catalog-result-heading">
        <h2>
          {query.trim()
            ? `Results for “${query.trim()}”`
            : view === "connected"
              ? `${organizationName} connections`
              : "All integrations"}
        </h2>
        <span>
          {matches.length}{" "}
          {matches.length === 1 ? "integration" : "integrations"}
        </span>
      </div>
      <div className="catalog-results">
        {matches.map((connector) => (
          <CatalogCard
            key={connector.id}
            connector={connector}
            connection={connections.find(
              (item) => item.connectorId === connector.id,
            )}
            onSelect={onSelect}
          />
        ))}
      </div>
      {!matches.length && (
        <div className="catalog-no-results">
          <Search size={23} />
          <h3>
            {query.trim()
              ? "No matching integrations"
              : "No integrations connected yet"}
          </h3>
          <p>
            {query.trim()
              ? "Try a different name or tool category."
              : `Choose an integration to connect ${organizationName}’s tools.`}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setView("all");
            }}
          >
            Browse integrations <ArrowRight size={14} />
          </button>
        </div>
      )}

    </div>
  );
}
