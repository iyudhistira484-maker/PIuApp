import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Menu, Search, X } from "lucide-react";
import { Logo } from "../ui";

function DocsProgress() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const v = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      root.style.setProperty("--docs-progress", v.toFixed(4));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="docs-progress" aria-hidden="true">
      <i />
    </div>
  );
}

export function DocsHeader({ active }: { active: "dokumentasi" | "panduan" | "aturan" }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <DocsProgress />
      <header className={`docs-header ${scrolled ? "is-scrolled" : ""} ${open ? "is-open" : ""}`}>
        <div className="docs-nav-surface">
          <Link to="/" className="docs-brand" aria-label="PiwuApp beranda" onClick={() => setOpen(false)}>
            <Logo />
            <span className="docs-brand-sep" aria-hidden="true" />
            <span className="docs-brand-label">Docs <span>v1.0</span></span>
          </Link>

          <nav className="docs-nav" aria-label="Navigasi dokumen">
            <Link to="/dokumentasi" className={active === "dokumentasi" ? "is-active" : ""}>Dokumentasi</Link>
            <Link to="/panduan" className={active === "panduan" ? "is-active" : ""}>Panduan</Link>
            <Link to="/aturan" className={active === "aturan" ? "is-active" : ""}>Aturan</Link>
            <Link to="/#pricing">Harga</Link>
          </nav>

          <div className="docs-header-actions">
            <div className="docs-search" aria-hidden="true">
              <Search size={14} />
              <span>Cari dokumentasi</span>
              <kbd>⌘ K</kbd>
            </div>
            <Link to="/login" className="docs-cta--ghost docs-cta">Masuk</Link>
            <Link to="/projects" className="docs-cta">Buka workspace <ArrowUpRight size={14} /></Link>
            <button
              className="docs-mobile-toggle"
              aria-label={open ? "Tutup menu" : "Buka menu"}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <>
          <button className="docs-drawer-backdrop" aria-label="Tutup menu" onClick={() => setOpen(false)} />
          <div className="docs-drawer" role="dialog" aria-modal="true" aria-label="Menu dokumen">
            <div className="docs-drawer-head">
              <b>Menu</b>
              <button className="docs-mobile-toggle" style={{ display: "grid" }} aria-label="Tutup" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            <nav>
              <Link to="/dokumentasi" className={active === "dokumentasi" ? "is-active" : ""} onClick={() => setOpen(false)}>📘 Dokumentasi</Link>
              <Link to="/panduan" className={active === "panduan" ? "is-active" : ""} onClick={() => setOpen(false)}>🧭 Panduan</Link>
              <Link to="/aturan" className={active === "aturan" ? "is-active" : ""} onClick={() => setOpen(false)}>⚖️ Aturan & ketentuan</Link>
              <Link to="/#pricing" onClick={() => setOpen(false)}>💳 Harga & paket</Link>
              <Link to="/#templates" onClick={() => setOpen(false)}>🎨 Template</Link>
              <Link to="/#faq" onClick={() => setOpen(false)}>❓ FAQ</Link>
            </nav>
            <div style={{ marginTop: 20, display: "grid", gap: 8 }}>
              <Link to="/projects" className="docs-cta" style={{ justifyContent: "center" }} onClick={() => setOpen(false)}>Buka workspace <ArrowUpRight size={14} /></Link>
              <Link to="/login" className="docs-cta docs-cta--ghost" style={{ justifyContent: "center" }} onClick={() => setOpen(false)}>Masuk akun</Link>
            </div>
            <p style={{ marginTop: 16, fontSize: 11, color: "#8a8d85", lineHeight: 1.6, textAlign: "center" }}>
              PiwuApp Docs · Dibuat di Indonesia<br />untuk semua pembuat.
            </p>
          </div>
        </>
      )}
    </>
  );
}
