import express from "express";
import path from "node:path";
import { createApp } from "./app.mjs";
const { app, stop } = createApp({});
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("dist"), { index: false }));
  app.get("/{*path}", (_, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
}
const port = Number(
  process.env.PORT || (process.env.NODE_ENV === "production" ? 3001 : 3002),
);
const server = app.listen(port, "0.0.0.0", () =>
  console.log(
    `PiwuApp API :${port} · status integrasi tersedia di /api/status`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    server.close(() => process.exit(0));
  });
