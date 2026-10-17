import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronUp, Loader2, RefreshCw, Search } from "lucide-react";
import {
  AI_TIERS,
  TIER_INFO,
  modelCost,
  type AiModelCatalog,
} from "../../lib/ai";
import "./ai-model-picker.css";

export type CatalogStatus = "idle" | "loading" | "ready" | "error";

function groupOf(catalog: AiModelCatalog | null, model: string) {
  return catalog?.groups.find((g) => g.models.includes(model))?.label || "";
}

/**
 * Model picker for the AI chat. The tier presets stay available at all times;
 * the rest of the list is exactly what the configured API key serves, grouped
 * only for readability. Every model the key offers is listed — nothing is
 * filtered out by a hardcoded provider allowlist.
 */
export default function AiModelPicker({
  value,
  onChange,
  catalog,
  status,
  error,
  onRefresh,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  catalog: AiModelCatalog | null;
  status: CatalogStatus;
  error: string;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // The composer lives in a narrow column, so the popover measures itself and
  // clamps to the viewport instead of overflowing the panel or the window.
  const [placement, setPlacement] = useState({
    left: 0,
    width: 330,
    maxHeight: 320,
    drop: false,
  });

  const sectioned = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (models: string[]) =>
      needle ? models.filter((m) => m.toLowerCase().includes(needle)) : models;
    const sections = [
      {
        label: "Pintar otomatis",
        hint: "Preset tier",
        models: (AI_TIERS as readonly string[]).filter((t) =>
          needle ? t.toLowerCase().includes(needle) : true,
        ),
      },
      ...(catalog?.groups || []).map((g) => ({
        label: g.label,
        hint: "",
        models: match(g.models),
      })),
    ].filter((section) => section.models.length);
    return sections;
  }, [catalog, query]);

  const flat = useMemo(
    () => sectioned.flatMap((section) => section.models),
    [sectioned],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(-1);
    const focus = window.setTimeout(() => search.current?.focus(), 30);
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.clearTimeout(focus);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const triggerBox = trigger.current?.getBoundingClientRect();
      const rootBox = root.current?.getBoundingClientRect();
      if (!triggerBox || !rootBox) return;
      const margin = 8;
      const width = Math.min(330, window.innerWidth - margin * 2);
      const minLeft = margin - rootBox.left;
      const maxLeft = window.innerWidth - margin - width - rootBox.left;
      const preferred = triggerBox.left - rootBox.left;
      const spaceAbove = triggerBox.top - margin - 6;
      const spaceBelow = window.innerHeight - triggerBox.bottom - margin - 6;
      const drop = spaceAbove < 200 && spaceBelow > spaceAbove;
      setPlacement({
        left: Math.min(
          Math.max(preferred, minLeft),
          Math.max(minLeft, maxLeft),
        ),
        width,
        maxHeight: Math.max(120, Math.min(320, drop ? spaceBelow : spaceAbove)),
        drop,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const choose = (model: string) => {
    onChange(model);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!flat.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) =>
        Math.max(-1, Math.min(flat.length - 1, current + step)),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // Enter takes the highlighted model, or the first match when nothing is
      // highlighted yet, which is what typing a name and submitting should do.
      const target = flat[active] || flat[0];
      if (target) choose(target);
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  };

  const providers = catalog?.groups.length || 0;
  const tierHint = (tier: string) => {
    if (tier === "Otomatis")
      return catalog?.defaultModel
        ? `otomatis → ${catalog.defaultModel}`
        : "otomatis memilih tier";
    return catalog?.tiers[tier]
      ? catalog.tiers[tier]
      : catalog?.defaultModel
        ? `fallback ${catalog.defaultModel}`
        : "";
  };
  /** What one chat turn costs here, from the server catalogue when we have it. */
  const price = (model: string) => modelCost({ model, catalog });
  /**
   * "3 kredit/pesan", or the range a preset can take when the prompt decides.
   * Otomatis never picks Cepat (server rule: long prompts or attachments go
   * Kuat, everything else Seimbang), so the range starts at Seimbang instead of
   * promising a price it can never charge.
   */
  const priceLabel = (model: string) => {
    if (model === "Otomatis") {
      const seimbang = price("Seimbang").cost;
      const kuat = price("Kuat").cost;
      const low = Math.min(seimbang, kuat);
      const high = Math.max(seimbang, kuat);
      return low === high
        ? `${low} kredit/pesan`
        : `${low}–${high} kredit/pesan`;
    }
    return `${price(model).cost} kredit/pesan`;
  };

  return (
    <div className="ai-model-picker" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="ai-model-trigger"
        aria-label="Pilih model"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value}</span>
        <em className="ai-model-price">{priceLabel(value)}</em>
        {value !== "Otomatis" &&
        !(AI_TIERS as readonly string[]).includes(value)
          ? groupOf(catalog, value) && <em>{groupOf(catalog, value)}</em>
          : null}
        <ChevronUp size={10} className="ai-model-chevron" />
      </button>
      {open && (
        <div
          className={"ai-model-menu" + (placement.drop ? " drop-down" : "")}
          style={{
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
          onKeyDown={onKeyDown}
        >
          <div className="ai-model-search">
            <Search size={11} />
            <input
              ref={search}
              role="combobox"
              aria-label="Cari model"
              aria-expanded="true"
              aria-controls="ai-model-list"
              aria-activedescendant={
                active >= 0 && flat[active] ? `ai-model-${active}` : ""
              }
              placeholder={
                status === "loading" ? "Membaca daftar model…" : "Cari model…"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(-1);
              }}
            />
            {status === "loading" ? (
              <Loader2 size={11} className="ai-model-spin" />
            ) : (
              <button
                type="button"
                className="ai-model-refresh"
                aria-label="Muat ulang daftar model"
                title="Muat ulang daftar model"
                onClick={onRefresh}
              >
                <RefreshCw size={10} />
              </button>
            )}
          </div>
          <ul id="ai-model-list" role="listbox" aria-label="Daftar model AI">
            {sectioned.map((section) => (
              <li key={section.label} role="presentation">
                <span className="ai-model-group">
                  {section.label}
                  {section.hint && <i>{section.hint}</i>}
                </span>
                <ul role="presentation">
                  {section.models.map((model) => {
                    const index = flat.indexOf(model);
                    const isTier = (AI_TIERS as readonly string[]).includes(
                      model,
                    );
                    const tier = isTier ? model : price(model).tier;
                    return (
                      <li
                        key={model}
                        id={`ai-model-${index}`}
                        data-model={model}
                        role="option"
                        aria-selected={model === value}
                        className={
                          "ai-model-option" +
                          (index === active ? " is-active" : "") +
                          (model === value ? " is-selected" : "")
                        }
                        onMouseMove={() => setActive(index)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(model)}
                      >
                        <span className="ai-model-name">{model}</span>
                        {isTier ? (
                          <small>
                            {TIER_INFO[model]} · {priceLabel(model)}
                            {tierHint(model) ? " · " + tierHint(model) : ""}
                          </small>
                        ) : catalog?.tiers[tier] === model ? (
                          <small>
                            dipakai untuk tier {tier} · {price(model).cost}{" "}
                            kredit
                          </small>
                        ) : (
                          // The price printed here is the price the server bills:
                          // it comes from the catalogue (costs[]), not from a
                          // number typed into this component.
                          <small>{priceLabel(model)}</small>
                        )}
                        {model === value && <Check size={11} />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {!flat.length && (
              <li className="ai-model-empty" role="presentation">
                {status === "loading"
                  ? "Membaca daftar model dari provider…"
                  : "Tidak ada model yang cocok dengan pencarian ini."}
              </li>
            )}
          </ul>
          <div className="ai-model-note">
            {status === "error" ? (
              <>
                <span>{error}</span>
                <button type="button" onClick={onRefresh}>
                  Coba lagi
                </button>
              </>
            ) : (
              <span>
                {catalog
                  ? `${catalog.count} model dari API key Anda · ${providers} grup · harga per pesan dari server`
                  : "Daftar model diambil dari endpoint /models provider Anda. Harga per pesan menyusul dari server."}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
