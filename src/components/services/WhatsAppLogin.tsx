import { useStore } from "../../lib/store";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { api } from "../../services/api";
export default function WhatsAppLogin({
  onSuccess,
}: {
  onSuccess: () => void;
}) {
  const [phone, setPhone] = useState(""),
    [otp, setOtp] = useState(""),
    [sent, setSent] = useState(false),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [retryAt, setRetryAt] = useState(0);
  useEffect(() => {
    void api("/status")
      .then((s) => setEnabled(s.capabilities.whatsapp))
      .catch(() => {});
  }, []);
  return (
    <details style={{ margin: "18px 0" }}>
      <summary>Masuk dengan OTP WhatsApp</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!supabase || !enabled) return;
          setBusy(true);
          setMessage("");
          try {
            if (!/^\+[1-9]\d{7,14}$/.test(phone))
              throw new Error(
                "Gunakan format internasional, contoh +628123456789.",
              );
            if (sent) {
              const r = await supabase.auth.verifyOtp({
                phone,
                token: otp,
                type: "sms",
              });
              if (r.error) throw r.error;
              if (r.data.session) {
                const u = r.data.session.user;
                useStore.getState().setUser({
                  id: u.id,
                  email: u.email || "",
                  name: u.user_metadata?.name || "Pembuat",
                  demo: false,
                });
                onSuccess();
              }
            } else {
              if (Date.now() < retryAt)
                throw new Error("Tunggu 60 detik sebelum mengirim ulang.");
              const r = await supabase.auth.signInWithOtp({
                phone,
                options: { channel: "sms" },
              });
              if (r.error) throw r.error;
              setSent(true);
              setRetryAt(Date.now() + 60000);
              setMessage("Permintaan OTP diterima. Periksa WhatsApp Anda.");
            }
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Verifikasi gagal.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nomor WhatsApp
          <input
            type="tel"
            autoComplete="tel"
            placeholder="+628123456789"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setSent(false);
            }}
            disabled={busy}
          />
        </label>
        {sent && (
          <label>
            Kode OTP
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              maxLength={8}
            />
          </label>
        )}
        <button
          className="button button-outline full-width"
          disabled={busy || !enabled}
        >
          {busy ? "Memproses…" : sent ? "Verifikasi OTP" : "Kirim OTP WhatsApp"}
        </button>
        {sent && (
          <button
            type="button"
            className="button button-outline full-width mt-3"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setOtp("");
            }}
          >
            Kirim ulang / ubah nomor
          </button>
        )}
        {!enabled && <p>WhatsApp belum dikonfigurasi oleh administrator.</p>}
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}
