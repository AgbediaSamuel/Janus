import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function icon(name: string, drawing: ReactNode) {
  function Icon({ size = 24, strokeWidth = 1.7, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        {...props}
      >
        <g
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {drawing}
        </g>
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

const tint = { fill: "currentColor", fillOpacity: 0.13, stroke: "none" };

export const Overview = icon(
  "Overview",
  <>
    <rect
      x="3"
      y="3"
      width="7"
      height="8"
      rx="2"
      fill="currentColor"
      stroke="none"
    />
    <rect x="14" y="3" width="7" height="5" rx="1.5" {...tint} />
    <path d="M15 4h5v3h-5zM4 16h5v4H4z" />
    <rect
      x="14"
      y="12"
      width="7"
      height="9"
      rx="2"
      fill="currentColor"
      stroke="none"
    />
  </>,
);
export const Activity = icon(
  "Activity",
  <>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
    <circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="21" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </>,
);
export const Layers3 = icon(
  "Cases",
  <>
    <path
      d="M4 7V5a2 2 0 0 1 2-2h5l2 3h5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"
      {...tint}
    />
    <path d="M4 8V5a2 2 0 0 1 2-2h5l2 3h5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8h16M8 12h8M8 16h5" />
  </>,
);
export const Plug = icon(
  "Integrations",
  <>
    <rect
      x="3"
      y="3"
      width="7"
      height="7"
      rx="2"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="14"
      y="14"
      width="7"
      height="7"
      rx="2"
      fill="currentColor"
      stroke="none"
    />
    <rect x="14" y="3" width="7" height="7" rx="2" {...tint} />
    <path d="M16 4h3v5h-3zM4 16h5v4H4zM10 6.5h4M6.5 10v4M10 17.5h4M17.5 10v4" />
  </>,
);
export const Network = icon(
  "OrganizationNetwork",
  <>
    <path d="M6 6c10 0 0 12 12 12M18 6C8 6 16 18 6 18" strokeWidth="2" />
    <rect
      x="2"
      y="2"
      width="8"
      height="8"
      rx="3"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="14"
      y="14"
      width="8"
      height="8"
      rx="3"
      fill="currentColor"
      stroke="none"
    />
    <circle cx="18" cy="6" r="3" fill="var(--surface, #fff)" />
    <circle cx="6" cy="18" r="3" fill="var(--surface, #fff)" />
  </>,
);
export const Workflow = icon(
  "Relay",
  <>
    <path d="M7 6h5a6 6 0 0 1 6 6v5M17 18h-5a6 6 0 0 1-6-6V7" />
    <path d="m14 15 4 4 4-4M10 9 6 5 2 9" />
    <circle cx="6" cy="18" r="3" fill="currentColor" stroke="none" />
    <circle cx="18" cy="6" r="3" fill="currentColor" stroke="none" />
  </>,
);
export const FileText = icon(
  "Evidence",
  <>
    <path d="M5 3h9l5 5v13H5Z" {...tint} />
    <path d="M5 3h9l5 5v13H5V3Zm9 0v5h5M9 12h6M9 16h4" />
  </>,
);
export const FileSearch = icon(
  "InspectEvidence",
  <>
    <path d="M4 3h9l4 4v4M4 3v18h7M13 3v5h4" />
    <circle cx="15" cy="15" r="4" {...tint} />
    <circle cx="15" cy="15" r="4" />
    <path d="m18 18 3 3M8 8h1M8 12h1" />
  </>,
);
export const MessageSquare = icon(
  "Correspondence",
  <>
    <path d="M3 5h18v13H9l-6 4V5Z" {...tint} />
    <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2ZM7 9h10M7 13h6" />
  </>,
);
export const ShieldCheck = icon(
  "AuthorizedAction",
  <>
    <path d="m12 2 8 3v7c0 5-4 8-8 10-4-2-8-5-8-10V5Z" {...tint} />
    <path d="m12 2 8 3v7c0 5-4 8-8 10-4-2-8-5-8-10V5l8-3Zm-4 10 3 3 5-6" />
  </>,
);
export const Fingerprint = icon(
  "PrivateBoundary",
  <>
    <path d="M3 12a9 9 0 0 1 18 0M6 13v-1a6 6 0 0 1 12 0v4M9 14v-2a3 3 0 0 1 6 0v5M3 16v3M6 17v4M9 18v3M12 12v10M18 20v1M21 16v3" />
  </>,
);
export const Database = icon(
  "DataSource",
  <>
    <path d="M4 6v12c0 2 3.5 3 8 3s8-1 8-3V6Z" {...tint} />
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 2 3.5 3 8 3s8-1 8-3V6M4 12c0 2 3.5 3 8 3s8-1 8-3" />
  </>,
);
export const Server = icon(
  "Runtime",
  <>
    <rect x="3" y="3" width="18" height="7" rx="2" {...tint} />
    <rect x="3" y="14" width="18" height="7" rx="2" {...tint} />
    <rect x="3" y="3" width="18" height="7" rx="2" />
    <rect x="3" y="14" width="18" height="7" rx="2" />
    <path d="M7 6.5h.01M7 17.5h.01M13 6.5h4M13 17.5h4" strokeWidth="2.3" />
  </>,
);
export const Box = icon(
  "Workspace",
  <>
    <path d="m12 2 9 5v10l-9 5-9-5V7Z" {...tint} />
    <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10M8 4l9 5" />
  </>,
);
export const Cloud = icon(
  "Cloud",
  <>
    <path d="M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13 0 5 5 0 0 1 0 10Z" {...tint} />
    <path d="M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13 0 5 5 0 0 1 0 10Z" />
  </>,
);
export const Globe2 = icon(
  "Endpoint",
  <>
    <circle cx="12" cy="12" r="9" {...tint} />
    <circle cx="12" cy="12" r="9" />
    <ellipse cx="12" cy="12" rx="4" ry="9" />
    <path d="M3 12h18" />
  </>,
);
export const LockKeyhole = icon(
  "Private",
  <>
    <rect x="5" y="10" width="14" height="11" rx="2" {...tint} />
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
  </>,
);
export const CheckCircle2 = icon(
  "Verified",
  <>
    <circle cx="12" cy="12" r="9" {...tint} />
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" strokeWidth="2" />
  </>,
);
export const TriangleAlert = icon(
  "Attention",
  <>
    <path d="m12 3 10 18H2Z" {...tint} />
    <path d="m12 3 10 18H2L12 3Zm0 6v5M12 17h.01" />
  </>,
);
export const Clock3 = icon(
  "Time",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6l4 2" />
  </>,
);
export const Search = icon(
  "Search",
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 5 5" strokeWidth="2.3" />
  </>,
);
export const SlidersHorizontal = icon(
  "Filter",
  <>
    <path d="M3 6h6m4 0h8M3 18h10m4 0h4" />
    <rect
      x="9"
      y="3"
      width="4"
      height="6"
      rx="1"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="13"
      y="15"
      width="4"
      height="6"
      rx="1"
      fill="currentColor"
      stroke="none"
    />
  </>,
);
export const Code2 = icon(
  "Api",
  <>
    <path d="m7 6-5 6 5 6M17 6l5 6-5 6M14 3l-4 18" />
  </>,
);
export const Terminal = icon(
  "Reproduction",
  <>
    <rect x="2" y="4" width="20" height="16" rx="3" {...tint} />
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <path d="m6 9 3 3-3 3M12 15h5" />
  </>,
);
export const Zap = icon(
  "Action",
  <path d="M14 2 4 14h7l-1 8L21 9h-8l1-7Z" fill="currentColor" stroke="none" />,
);
export const Play = icon(
  "Run",
  <path
    d="M6 3.5a1 1 0 0 1 1.5-.8l13 8.5a1 1 0 0 1 0 1.6l-13 8.5a1 1 0 0 1-1.5-.8Z"
    fill="currentColor"
    stroke="none"
  />,
);
export const Unplug = icon(
  "Disconnected",
  <>
    <path d="m8 4 3 3m5 9 4 4M4 8l3 3m9 5 4 4M9 5l-4 4 4 4 4-4-4-4ZM15 11l-4 4 4 4 4-4-4-4ZM3 21 21 3" />
  </>,
);
export const Circle = icon("State", <circle cx="12" cy="12" r="8" />);
export const CircleDot = icon(
  "Connected",
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
  </>,
);
export const Check = icon(
  "Check",
  <path d="m5 12 4.5 4.5L19 7" strokeWidth="2.2" />,
);
export const Plus = icon("Add", <path d="M12 4v16M4 12h16" />);
export const X = icon("Close", <path d="m6 6 12 12M18 6 6 18" />);
export const ChevronRight = icon("Next", <path d="m9 5 7 7-7 7" />);
export const ChevronDown = icon("Expand", <path d="m5 9 7 7 7-7" />);
export const ArrowRight = icon("Forward", <path d="M3 12h18m-7-7 7 7-7 7" />);
export const ArrowLeft = icon("Back", <path d="M21 12H3m7-7-7 7 7 7" />);
export const ArrowDown = icon("Down", <path d="M12 3v18m-7-7 7 7 7-7" />);
export const ArrowUpRight = icon("Open", <path d="M5 19 19 5M5 5h14v14" />);
export const ArrowLeftRight = icon(
  "Exchange",
  <path d="M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4" />,
);
export const ExternalLink = icon(
  "ExternalLink",
  <path d="M14 3h7v7M21 3 10 14M10 5H4v15h15v-6" />,
);
export const RefreshCw = icon(
  "Refresh",
  <>
    <path d="M20 9a8 8 0 0 0-14-4L3 8M4 15a8 8 0 0 0 14 4l3-3M3 3v5h5M21 21v-5h-5" />
  </>,
);
export const Loader2 = icon(
  "Loading",
  <>
    <circle cx="12" cy="12" r="9" strokeOpacity=".18" />
    <path d="M12 3a9 9 0 0 1 9 9" strokeWidth="2.2" />
  </>,
);
