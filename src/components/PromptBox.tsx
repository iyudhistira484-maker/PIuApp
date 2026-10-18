import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Mic,
  ArrowUp,
  ChevronDown,
  Hammer,
  ListChecks,
  Paperclip,
  X,
} from "lucide-react";
import { useStore } from "../lib/store";
type Props = {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  mode: "Builder" | "Plan";
  onModeChange: (s: "Builder" | "Plan") => void;
  compact?: boolean;
  placeholder?: string;
};
export default function PromptBox({
  value,
  onChange,
  onSubmit,
  mode,
  onModeChange,
  compact,
  placeholder = "Minta PiwuApp membuat aplikasi tentang…",
}: Props) {
  const [menu, setMenu] = useState(false);
  const [attachment, setAttachment] = useState("");
  const [listening, setListening] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const modeWrap = useRef<HTMLDivElement>(null);
  const modeButton = useRef<HTMLButtonElement>(null);
  const notify = useStore((s) => s.notify);
  useEffect(() => {
    if (!menu) return;
    // Like the landing navigation: the composer menu closes on outside click
    // and on Escape, which also hands focus back to its trigger.
    const outside = (event: PointerEvent) => {
      if (!modeWrap.current?.contains(event.target as Node)) setMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenu(false);
      modeButton.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  function voice() {
    const Recognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      notify(
        "Input suara belum didukung browser ini. Gunakan Chrome atau ketik ide Anda.",
      );
      return;
    }
    const r = new Recognition();
    r.lang = "id-ID";
    r.interimResults = true;
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      notify("Mikrofon tidak dapat diakses. Periksa izin browser.");
    };
    r.onresult = (e: any) =>
      onChange(
        value +
          " " +
          Array.from(e.results)
            .map((x: any) => x[0].transcript)
            .join(""),
      );
    r.start();
  }
  return (
    <div className={"prompt-box " + (compact ? "compact" : "")}>
      <label className="sr-only" htmlFor="hero-prompt">
        Ceritakan ide aplikasi Anda
      </label>
      <textarea
        id="hero-prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim()) onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={2}
      />
      {attachment && (
        <span className="attachment">
          <Paperclip size={12} />
          {attachment}
          <button aria-label="Hapus lampiran" onClick={() => setAttachment("")}>
            <X size={12} />
          </button>
        </span>
      )}
      <div className="prompt-bottom">
        <div className="prompt-tools">
          <button
            className="icon-button attach-button"
            aria-label="Lampirkan referensi"
            onClick={() => input.current?.click()}
          >
            <Plus size={20} />
          </button>
          <input
            hidden
            ref={input}
            type="file"
            accept="image/*,.pdf,.fig,.txt"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                setAttachment(e.target.files[0].name);
                notify(
                  "Referensi dipilih. Pemrosesan multimodal memerlukan provider AI yang mendukung lampiran.",
                );
              }
            }}
          />
          <span className="tool-divider" />
          <div className="mode-wrap" ref={modeWrap}>
            <button
              className="mode-button"
              ref={modeButton}
              onClick={() => setMenu(!menu)}
              aria-expanded={menu}
              aria-haspopup="true"
            >
              {mode === "Builder" ? (
                <Hammer size={14} />
              ) : (
                <ListChecks size={14} />
              )}{" "}
              {mode === "Builder" ? "Bangun" : "Rencana"}
              <ChevronDown size={12} />
            </button>
            {menu && (
              <div className="dropdown mode-dropdown">
                <button
                  onClick={() => {
                    onModeChange("Builder");
                    setMenu(false);
                  }}
                >
                  <Hammer size={15} /> Bangun aplikasi
                </button>
                <button
                  onClick={() => {
                    onModeChange("Plan");
                    setMenu(false);
                  }}
                >
                  <ListChecks size={15} /> Rencanakan dahulu
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="prompt-tools">
          <span className="enter-hint">Enter untuk memulai</span>
          <button
            className={"icon-button " + (listening ? "listening" : "")}
            onClick={voice}
            aria-label="Gunakan suara"
          >
            <Mic size={18} />
          </button>
          <button
            className="send-button"
            aria-label="Kirim ide dan buat project"
            disabled={!value.trim()}
            onClick={onSubmit}
          >
            <ArrowUp size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
