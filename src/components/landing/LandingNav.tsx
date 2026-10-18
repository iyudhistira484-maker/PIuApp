import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  LayoutDashboard,
  Laptop,
  Menu,
  MessageCircle,
  Shapes,
  ShoppingBag,
  X,
} from "lucide-react";
import { Logo } from "../ui";
import "./landing-nav.css";

type Props = {
  signedIn: boolean;
  onCategory: (category: string) => void;
  onCommunity: () => void;
};
const groups = {
  solutions: {
    label: "Solusi",
    heading: "Dari ide menjadi aplikasi",
    items: [
      {
        label: "Website & landing page",
        description: "Hadirkan ide Anda di web.",
        href: "#templates",
        category: "Landing page",
        Icon: Laptop,
      },
      {
        label: "Alat internal & dashboard",
        description: "Ruang kerja untuk bisnis Anda.",
        href: "#templates",
        category: "Dashboard",
        Icon: LayoutDashboard,
      },
      {
        label: "Toko online & UMKM",
        description: "Mulai dari etalase yang tepat.",
        href: "#templates",
        category: "E-commerce",
        Icon: ShoppingBag,
      },
    ],
  },
  resources: {
    label: "Sumber daya",
    heading: "Langkah pertama Anda",
    items: [
      {
        label: "Dokumentasi",
        description: "Semua yang perlu Anda tahu.",
        href: "/dokumentasi",
        category: "",
        Icon: BookOpen,
      },
      {
        label: "Panduan",
        description: "Langkah-demi-langkah sampai publish.",
        href: "/panduan",
        category: "",
        Icon: BookOpen,
      },
      {
        label: "Koleksi template",
        description: "Temukan titik awal untuk ide Anda.",
        href: "#templates",
        category: "Semua",
        Icon: Shapes,
      },
    ],
  },
  docs: {
    label: "Aturan",
    heading: "Transparan sejak awal",
    items: [
      {
        label: "Aturan & ketentuan",
        description: "Hak, kewajiban, dan pembayaran.",
        href: "/aturan",
        category: "",
        Icon: MessageCircle,
      },
      {
        label: "Harga & paket",
        description: "Kredit, biaya, dan batasan.",
        href: "#pricing",
        category: "",
        Icon: ShoppingBag,
      },
      {
        label: "Keamanan & privasi",
        description: "Isolasi, RLS, dan data Anda.",
        href: "#security",
        category: "",
        Icon: BookOpen,
      },
    ],
  },
};
type Group = keyof typeof groups;

export default function LandingNav({
  signedIn,
  onCategory,
  onCommunity,
}: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState<Group | null>(null);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const triggers = useRef<Partial<Record<Group, HTMLButtonElement | null>>>({});
  const close = () => {
    setOpen(null);
    setMobile(false);
  };

  useEffect(() => {
    // Only change React state when crossing the threshold, not on every frame.
    const onScroll = () => setScrolled(window.scrollY > 24);
    const desktop = window.matchMedia("(min-width: 1001px)");
    const onResize = () => {
      setOpen(null);
      setMobile(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    desktop.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      desktop.removeEventListener("change", onResize);
    };
  }, []);

  useEffect(() => {
    if (!open && !mobile) return;
    const outside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (open) {
        triggers.current[open]?.focus();
        setOpen(null);
      } else {
        toggle.current?.focus();
        setMobile(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, mobile]);

  return (
    <header
      ref={header}
      className={`landing-header${scrolled ? " is-scrolled" : ""}${mobile ? " is-open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <div className="landing-nav-surface">
        <div className="landing-nav-brand" onClick={close}>
          <Logo />
        </div>
        <nav
          id="landing-navigation"
          aria-label="Navigasi utama"
          className={`landing-navigation${mobile ? " is-open" : ""}`}
        >
          <span className="landing-mobile-label">Jelajahi PiwuApp</span>
          {(Object.keys(groups) as Group[]).map((key) => {
            const group = groups[key];
            return (
              <div className="landing-nav-group" key={key}>
                <button
                  ref={(element) => {
                    triggers.current[key] = element;
                  }}
                  className="landing-nav-link"
                  aria-expanded={open === key}
                  aria-controls={`landing-${key}`}
                  onClick={() => setOpen(open === key ? null : key)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setOpen(key);
                      requestAnimationFrame(() =>
                        header.current
                          ?.querySelector<HTMLAnchorElement>(
                            `#landing-${key} a`,
                          )
                          ?.focus(),
                      );
                    }
                  }}
                >
                  {group.label}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <div
                  id={`landing-${key}`}
                  className="landing-nav-popover"
                  hidden={open !== key}
                >
                  <p className="landing-nav-eyebrow">{group.heading}</p>
                  {group.items.map(
                    ({ label, description, href, category, Icon }) => {
                      const isInternal = href.startsWith("/");
                      const content = (
                        <>
                          <span className="landing-nav-item-icon">
                            <Icon size={19} aria-hidden="true" />
                          </span>
                          <span>
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </span>
                          <ArrowUpRight
                            className="landing-nav-item-arrow"
                            size={15}
                            aria-hidden="true"
                          />
                        </>
                      );
                      return isInternal ? (
                        <Link
                          key={label}
                          to={href}
                          onClick={() => {
                            if (category) onCategory(category);
                            close();
                          }}
                        >
                          {content}
                        </Link>
                      ) : (
                        <a
                          key={label}
                          href={href}
                          onClick={() => {
                            if (category) onCategory(category);
                            close();
                          }}
                        >
                          {content}
                        </a>
                      );
                    },
                  )}
                </div>
              </div>
            );
          })}
          <button
            className="landing-nav-link"
            onClick={() => {
              close();
              onCommunity();
            }}
          >
            Komunitas
          </button>
          <a className="landing-nav-link" href="#pricing" onClick={close}>
            Harga
          </a>
          <a className="landing-nav-link" href="#security" onClick={close}>
            Keamanan
          </a>
          {!signedIn && (
            <Link className="landing-mobile-login" to="/login" onClick={close}>
              Sudah punya akun?{" "}
              <strong>
                Masuk <ArrowUpRight size={14} />
              </strong>
            </Link>
          )}
        </nav>
        <div className="landing-nav-actions">
          {!signedIn && (
            <Link className="landing-nav-login" to="/login">
              Masuk
            </Link>
          )}
          <Link
            className="landing-nav-cta"
            to={signedIn ? "/projects" : "/login"}
          >
            {signedIn ? "Workspace saya" : "Mulai sekarang"}
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
          <button
            ref={toggle}
            className="landing-nav-toggle"
            aria-label={mobile ? "Tutup menu" : "Buka menu"}
            aria-expanded={mobile}
            aria-controls="landing-navigation"
            onClick={() => {
              setMobile(!mobile);
              setOpen(null);
            }}
          >
            {mobile ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}
