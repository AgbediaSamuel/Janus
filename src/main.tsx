import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

const workspace = /^\/app(?:\/|$)/.test(window.location.pathname);
const Page = lazy(() =>
  workspace
    ? Promise.all([import("./App"), import("./App.css")]).then(
        ([module]) => module,
      )
    : import("./Landing"),
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <div
          role="status"
          style={{ padding: 32, fontFamily: "serif", fontSize: 32 }}
        >
          Janus
        </div>
      }
    >
      <Page />
    </Suspense>
  </React.StrictMode>,
);
