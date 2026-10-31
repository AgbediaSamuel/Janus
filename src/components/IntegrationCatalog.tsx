import { useEffect, useRef, useState } from "react";
import type { Connection, ConnectorDefinition } from "../types";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
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

const communication = new Set([
  "slack",
  "teams",
  "microsoft-teams",
  "gmail",
  "outlook",
]);
const work = new Set(["linear", "github", "zendesk", "salesforce", "work-iq"]);
const collections = [
  {
    id: "talk",
    title: "Where your team talks",
    description: "Bring the people closest to the issue into the conversation.",
  },
  {
    id: "report",
    title: "What your systems report",
    description: "Give investigations the logs, traces, and signals they need.",
  },
  {
    id: "work",
    title: "Where your work happens",
    description: "Keep issues, code, and customer context together.",
  },
  {
    id: "run",
    title: "What your business runs on",
    description: "Connect the services and data behind your product.",
  },
  {
    id: "extend",
    title: "Make it your own",
    description: "Connect other systems through their existing interfaces.",
  },
];
function collectionFor(connector: ConnectorDefinition) {
  if (communication.has(connector.id)) return "talk";
  if (work.has(connector.id)) return "work";
  if (connector.category === "Observability") return "report";
  if (connector.category === "Extensibility") return "extend";
  return "run";
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

function CatalogRail({
  title,
  description,
  items,
  connections,
  onSelect,
}: {
  title: string;
  description: string;
  items: ConnectorDefinition[];
  connections: Connection[];
  onSelect: (connector: ConnectorDefinition) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canPrevious, setCanPrevious] = useState(false);
  const [canNext, setCanNext] = useState(false);
  function measure() {
    const element = rail.current;
    if (!element) return;
    setCanPrevious(element.scrollLeft > 2);
    setCanNext(
      element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
    );
  }
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [expanded, items.length]);
  function scroll(direction: number) {
    const element = rail.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
  const remainder = items.slice(4);
  return (
    <section className="catalog-collection" aria-label={title}>
      <div className="catalog-collection-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {!expanded && (canPrevious || canNext) && (
          <div className="catalog-rail-controls">
            <button
              type="button"
              aria-label={`Previous ${title.toLowerCase()} integrations`}
              disabled={!canPrevious}
              onClick={() => scroll(-1)}
            >
              <ArrowLeft size={15} />
            </button>
            <button
              type="button"
              aria-label={`Next ${title.toLowerCase()} integrations`}
              disabled={!canNext}
              onClick={() => scroll(1)}
            >
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
      <div
        className={`catalog-rail ${expanded ? "expanded" : ""}`}
        ref={rail}
        onScroll={measure}
      >
        {items.map((connector) => (
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
      {items.length > 4 && (
        <div className="catalog-collection-footer">
          {!expanded && (
            <div
              className="catalog-more-icons"
              aria-label="More integrations in this collection"
            >
              {remainder.slice(0, 10).map((connector) => (
                <button
                  type="button"
                  key={connector.id}
                  title={connector.name}
                  aria-label={`Configure ${connector.name}`}
                  onClick={() => onSelect(connector)}
                >
                  <ProviderLogo connectorId={connector.id} size={21} />
                </button>
              ))}
              {remainder.length > 10 && (
                <button
                  type="button"
                  className="catalog-more-count"
                  onClick={() => setExpanded(true)}
                >
                  +{remainder.length - 10} more
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            className="catalog-show-all"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show less" : `See all ${items.length}`}
            <ChevronDown size={13} className={expanded ? "rotated" : ""} />
          </button>
        </div>
      )}
    </section>
  );
}

export default function IntegrationCatalog({
  connectors,
  connections,
  onSelect,
  organizationName,
}: IntegrationCatalogProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"collections" | "all" | "connected">(
    "collections",
  );
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
  const showGrid = query.trim().length > 0 || view !== "collections";
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
            aria-pressed={view === "collections"}
            onClick={() => setView("collections")}
          >
            Collections
          </button>
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
      {showGrid ? (
        <>
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
                  setView("collections");
                }}
              >
                Browse integrations <ArrowRight size={14} />
              </button>
            </div>
          )}
        </>
      ) : (
        collections.map((collection) => {
          const items = connectors.filter(
            (connector) => collectionFor(connector) === collection.id,
          );
          return items.length > 0 ? (
            <CatalogRail
              key={collection.id}
              title={collection.title}
              description={collection.description}
              items={items}
              connections={connections}
              onSelect={onSelect}
            />
          ) : null;
        })
      )}
    </div>
  );
}
