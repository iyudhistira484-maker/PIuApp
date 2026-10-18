import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { api } from "../../services/api";
import { useStore } from "../../lib/store";
import { scopeFor } from "../../lib/cloud/types";
import { creditSpend } from "../../lib/dashboard/attention";
import {
  creditsNote,
  dailyLine,
  lastsLabel,
  serverDailyLine,
  usageProfile,
  type ServerCredits,
} from "../../lib/dashboard/plans";
import {
  LEDGER_DAYS,
  isLowBalance,
  spendByReason,
  type SpendRow,
} from "../../lib/dashboard/credits";

/**
 * Credit balance where the user actually starts a session: the dashboard sidebar.
 *
 * The numbers come from `GET /api/account`, which already answers with the
 * balance, the ledger and the plan — the same data the Akun & kredit page shows,
 * so nothing new had to be stored for this. When the call cannot be made (demo
 * mode, no session, server unreachable) the card says so instead of showing a
 * zero that would look like an empty wallet.
 */
type CardState =
  | { phase: "loading" }
  | { phase: "demo" }
  | { phase: "error" }
  | {
      phase: "ready";
      balance: number;
      plan: string;
      spend: number;
      ledgerDays: number;
      split: SpendRow[];
      low: boolean;
      /** What the server answered about today's allowance. */
      credits: ServerCredits | null;
    };

export default function CreditSummary() {
  const user = useStore((s) => s.user);
  const demo = scopeFor(user) === "demo";
  const [state, setState] = useState<CardState>(
    demo ? { phase: "demo" } : { phase: "loading" },
  );
  useEffect(() => {
    if (demo) {
      setState({ phase: "demo" });
      return;
    }
    let live = true;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const account = await api<{
          balance?: number;
          ledger?: { delta?: number; created_at?: string }[];
          plan?: { plan?: string } | null;
          credits?: ServerCredits | null;
        }>("/account");
        if (!live) return;
        const balance = Number(account.balance || 0);
        setState({
          phase: "ready",
          balance,
          plan: account.plan?.plan || "Free",
          spend: creditSpend(account.ledger, LEDGER_DAYS),
          ledgerDays: LEDGER_DAYS,
          split: spendByReason(account.ledger, LEDGER_DAYS),
          low: isLowBalance(balance),
          credits: account.credits || null,
        });
      } catch {
        if (live) setState({ phase: "error" });
      }
    })();
    return () => {
      live = false;
    };
  }, [demo, user?.id]);

  if (state.phase === "demo")
    return (
      <div className="dashboard-credit" data-phase="demo">
        <span>KREDIT</span>
        <b>Mode demo</b>
        <small>Kredit cloud hanya dipakai setelah masuk akun.</small>
      </div>
    );
  if (state.phase === "loading")
    return (
      <div className="dashboard-credit" data-phase="loading">
        <span>KREDIT</span>
        <b>Memuat…</b>
        <small>Menanyakan saldo terakhir ke server.</small>
      </div>
    );
  if (state.phase === "error")
    return (
      <div className="dashboard-credit" data-phase="error">
        <span>KREDIT</span>
        <b>Belum bisa dimuat</b>
        <small>
          Server tidak menjawab. Buka{" "}
          <Link to="/account">Akun &amp; kredit</Link> untuk mencoba lagi.
        </small>
      </div>
    );
  return (
    <div className="dashboard-credit" data-phase="ready">
      <span>
        KREDIT <Sparkles size={11} />
      </span>
      <b>{state.balance.toLocaleString("id-ID")}</b>
      <small>
        {state.plan} · {state.ledgerDays} hari terakhir:{" "}
        {state.spend.toLocaleString("id-ID")} kredit
      </small>
      <small className="credit-lasts">
        {lastsLabel(state.balance, usageProfile("normal"))} pada pemakaian
        normal · kredit paket &amp; top-up ada masa berlaku
      </small>
      {/* The allowance and its countdown come from the server answer when it has
          one; a database without migration 010 gets its own note instead of a
          quota that is not being granted. */}
      <small
        className="credit-daily"
        data-credits={state.credits?.source || ""}
      >
        {state.credits
          ? state.credits.applied
            ? serverDailyLine(state.credits)
            : creditsNote(state.credits)
          : dailyLine(state.plan)}
      </small>
      {!!state.split.length && (
        <ul className="credit-split">
          {state.split.map((row) => (
            <li key={row.reason || "lainnya"}>
              <span>
                {row.label}
                {row.count > 1 ? ` (${row.count}×)` : ""}
              </span>
              <b>{row.credits.toLocaleString("id-ID")}</b>
            </li>
          ))}
        </ul>
      )}
      {state.low && (
        <p className="credit-low">
          Saldo menipis — top up sebelum sesi berikutnya.
        </p>
      )}
      <Link to="/account">
        Rincian &amp; top up <ArrowUpRight size={11} />
      </Link>
    </div>
  );
}
