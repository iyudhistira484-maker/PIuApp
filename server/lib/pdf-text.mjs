import { Worker } from "node:worker_threads";
import { HttpError } from "./core.mjs";

// PDF text extraction lives in a worker on purpose: pdf.js is heavy and a
// malformed file must not be able to stall the server. Caps match the attachment
// path (20 pages, 20.000 characters, 15 s, 192 MB heap) and are documented as
// "not an OS sandbox".
export function pdfText(bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdf-worker.mjs", import.meta.url), {
      workerData: bytes,
      execArgv: [],
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new HttpError(408, "Pembacaan PDF melewati batas waktu."));
    }, 15000);
    let finished = false;
    const done = (error, text) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.terminate();
      error ? reject(error) : resolve(text);
    };
    worker.once("message", (r) =>
      done(r.error ? new HttpError(422, r.error) : null, r.text),
    );
    worker.once("error", () =>
      done(new HttpError(422, "PDF tidak dapat diproses.")),
    );
    worker.once("exit", (code) => {
      if (code !== 0 && !finished)
        done(new HttpError(422, "Proses PDF dihentikan."));
    });
  });
}
