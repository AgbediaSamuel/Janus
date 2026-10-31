import { createApp } from "./app";

const app = await createApp();
const port = Number(process.env.PORT || 4318);
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`Janus API listening at http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.locals.investigations.close();
    server.close();
  });
}
