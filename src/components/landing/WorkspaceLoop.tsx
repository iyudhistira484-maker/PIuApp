import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Code2,
  Globe2,
  Layers,
  Sparkles,
} from "lucide-react";

/**
 * Miniatur IDE di section "features" yang memainkan loop pendek setiap
 * kali masuk viewport: permintaan diketik di input, asisten membalas,
 * kode ditulis baris per baris, lalu preview muncul dan badge
 * "Preview siap" melompat keluar.
 *
 * Dengan prefers-reduced-motion (atau tanpa IntersectionObserver)
 * pengunjung langsung melihat keadaan akhir secara statis — tidak ada
 * animasi, tidak ada konten yang tersembunyi.
 */

const REDUCE = "(prefers-reduced-motion: reduce)";

const USER_PROMPT = "Buatkan landing page untuk studio desain.";
const AI_REPLY = "Siap. Saya susun strukturnya, lalu saya jalankan preview.";

type Tok = { t: string; c?: string };

const CODE: Tok[][] = [
  [
    { t: "<", c: "ws-punc" },
    { t: "StudioHero", c: "ws-tag" },
  ],
  [
    { t: "  " },
    { t: "judul", c: "ws-attr" },
    { t: "=", c: "ws-punc" },
    { t: '"Ruang yang baik,"', c: "ws-str" },
  ],
  [
    { t: "  " },
    { t: "sub", c: "ws-attr" },
    { t: "=", c: "ws-punc" },
    { t: '"cerita yang baru."', c: "ws-str" },
  ],
  [
    { t: "  " },
    { t: "cta", c: "ws-attr" },
    { t: "=", c: "ws-punc" },
    { t: '"Lihat karyanya"', c: "ws-str" },
  ],
  [{ t: "/>", c: "ws-punc" }],
];
const LINE_LEN = CODE.map((line) =>
  line.reduce((n, tok) => n + tok.t.length, 0),
);
const CODE_TOTAL = LINE_LEN.reduce((a, b) => a + b, 0);

// 0 mengetik input, 1 asisten berpikir, 2 mengetik balasan,
// 3 mengetik kode, 4 preview muncul, 5 siap, 6 memudar sebelum loop
type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function lineVisible(count: number, i: number): number {
  let off = 0;
  for (let k = 0; k < i; k++) off += LINE_LEN[k];
  return Math.max(0, Math.min(LINE_LEN[i], count - off));
}

function activeLineOf(count: number): number {
  let off = 0;
  for (let i = 0; i < LINE_LEN.length; i++) {
    if (count <= off + LINE_LEN[i]) return i;
    off += LINE_LEN[i];
  }
  return LINE_LEN.length - 1;
}

function renderTokens(line: Tok[], visible: number, caretLine: boolean) {
  const prefix = caretLine && visible === 0 ? <i className="ws-caret" /> : null;
  let left = visible;
  let caretPlaced = !caretLine;
  return [
    prefix,
    ...line.map((tok, i) => {
      const take = Math.max(0, Math.min(tok.t.length, left));
      left -= take;
      if (take === 0) return null;
      const putCaret = !caretPlaced && left === 0;
      if (putCaret) caretPlaced = true;
      return (
        <span key={i} className={tok.c}>
          {tok.t.slice(0, take)}
          {putCaret && <i className="ws-caret" />}
        </span>
      );
    }),
  ];
}

export default function WorkspaceLoop() {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(REDUCE).matches,
  );
  const [inView, setInView] = useState(false);
  const [stage, setStage] = useState<Stage>(0);
  const [promptChars, setPromptChars] = useState(0);
  const [replyChars, setReplyChars] = useState(0);
  const [codeChars, setCodeChars] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(REDUCE);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setInView(e.isIntersecting)),
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || reduced) return;
    let alive = true;
    const timers = new Set<number>();
    const after = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (alive) fn();
      }, ms);
      timers.add(id);
    };
    const type = (
      len: number,
      speed: number,
      set: (n: number) => void,
      done: () => void,
    ) => {
      set(0);
      let n = 0;
      const tick = () => {
        n += 1;
        set(Math.min(n, len));
        if (n < len) after(speed, tick);
        else done();
      };
      after(speed, tick);
    };
    const run = () => {
      setStage(0);
      setPromptChars(0);
      setReplyChars(0);
      setCodeChars(0);
      after(700, () =>
        type(USER_PROMPT.length, 34, setPromptChars, () => {
          after(300, () => {
            setStage(1);
            after(950, () => {
              setStage(2);
              type(AI_REPLY.length, 24, setReplyChars, () => {
                after(380, () => {
                  setStage(3);
                  type(CODE_TOTAL, 24, setCodeChars, () => {
                    after(520, () => {
                      setStage(4);
                      after(750, () => {
                        setStage(5);
                        after(2600, () => {
                          setStage(6);
                          after(560, run);
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        }),
      );
    };
    run();
    return () => {
      alive = false;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [inView, reduced]);

  const final = reduced;
  const s: Stage = final ? 5 : stage;
  const p = final ? USER_PROMPT.length : promptChars;
  const r = final ? AI_REPLY.length : replyChars;
  const c = final ? CODE_TOTAL : codeChars;
  const caretLine = s === 3 || s === 4 ? activeLineOf(c) : -1;

  return (
    <div
      ref={rootRef}
      className="workspace-illustration"
      data-stage={s}
      aria-hidden="true"
    >
      <div className="illustration-bar">
        <div className="window-dots">
          <i />
          <i />
          <i />
        </div>
        <span>Project luar biasa Anda</span>
        <span className="ws-sync">
          <i />
          Tersinkron
        </span>
      </div>
      <div className="illustration-body">
        <aside>
          <Code2 size={16} />
          <Layers size={16} />
          <Globe2 size={16} />
        </aside>
        <div className="illustration-code">
          <div className="ws-tab">
            <i />
            <span>StudioHero.tsx</span>
          </div>
          <div className="ws-editor">
            {CODE.map((line, li) => (
              <div className="ws-line" key={li}>
                <span className="ws-gutter">{li + 1}</span>
                <span className="ws-text">
                  {renderTokens(line, lineVisible(c, li), caretLine === li)}
                </span>
              </div>
            ))}
          </div>
          <div className={"illustration-preview" + (s >= 4 ? " ws-ready" : "")}>
            <div className="ws-skel">
              <i />
              <i />
              <i />
            </div>
            <span>Ruang yang baik,</span>
            <small className="ws-prev-sub">cerita yang baru.</small>
            <div />
            <small>STUDIO DESAIN ↗</small>
          </div>
        </div>
        <div className="illustration-chat">
          <span className="ai-badge">
            <Sparkles size={20} />
          </span>
          <div className="ws-messages">
            {s >= 1 && <div className="ws-msg ws-user">{USER_PROMPT}</div>}
            {s === 1 && (
              <span className="ws-dots">
                <i />
                <i />
                <i />
              </span>
            )}
            {s >= 2 && (
              <div className="ws-msg ws-ai">{AI_REPLY.slice(0, r)}</div>
            )}
          </div>
          <div className="illustration-success">
            <Check size={12} /> Preview siap
          </div>
          <div className="fake-input">
            <span className="ws-input-text">
              {s === 0 ? (
                <>
                  {USER_PROMPT.slice(0, p)}
                  <i className="ws-caret" />
                </>
              ) : (
                "Apa selanjutnya?"
              )}
            </span>
            <ArrowRight size={12} />
          </div>
        </div>
      </div>
    </div>
  );
}
