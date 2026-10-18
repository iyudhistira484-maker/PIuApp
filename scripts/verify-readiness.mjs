// Read-only operational diagnostic. Does not infer, execute shell, send email or charge money.
const base = process.env.PIWU_VERIFY_URL || "http://127.0.0.1:3002";
const states = [
  "reachable",
  "not_configured",
  "configured_unverified",
  "unreachable",
  "schema_missing",
  "rejected",
];
const features = [
  "auth",
  "database",
  "datasets",
  "administration",
  "studio",
  "ai",
  "search",
  "sandbox",
  "publish",
  "payments",
  "whatsapp",
  "secrets",
];
const report = {
  transport: "unreachable",
  services: {},
  liveVerified: false,
  notice:
    "Probe koneksi/skema bukan bukti inference, email, transaksi, deployment, atau penerapan ke Roblox Studio berhasil.",
};
try {
  const response = await fetch(new URL("/api/public/readiness", base), {
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("rejected");
  const result = await response.json();
  report.transport = "reachable";
  for (const key of features)
    report.services[key] = states.includes(result[key])
      ? result[key]
      : "unknown";
  report.paymentMode = result.paymentMode === "live" ? "live" : "sandbox";
} catch {
  report.error =
    "Endpoint kesiapan tidak merespons JSON yang valid dalam batas waktu.";
}
console.log(JSON.stringify(report, null, 2));
// Strict mode is suitable for activation checklists but never claims full live verification.
if (
  process.argv.includes("--strict") &&
  (report.transport !== "reachable" ||
    Object.values(report.services).some((s) => s !== "reachable"))
)
  process.exitCode = 1;
