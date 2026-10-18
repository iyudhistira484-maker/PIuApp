import {
  ArrowUpRight,
  ArrowRight,
  TrendingUp,
  Plus,
  Circle,
  ShoppingBag,
  Menu,
} from "lucide-react";
export default function TemplatePreview({
  type = "studio",
}: {
  type?: string;
}) {
  if (["mobile", "roblox"].includes(type))
    return (
      <div
        className="template-preview"
        style={{
          background: "#20352f",
          color: "#e3f2e8",
          display: "grid",
          placeContent: "center",
          gap: 12,
          padding: 20,
        }}
      >
        <strong style={{ fontSize: 24 }}>
          {type === "mobile" ? "Expo" : "Roblox"}
        </strong>
        <span style={{ fontSize: 12 }}>
          {type === "mobile"
            ? "React Native · Android / iOS"
            : "Luau · Explorer · 3D"}
        </span>
      </div>
    );
  if (type === "dashboard")
    return (
      <div className="template-preview mini-dashboard">
        <aside>
          <span className="mini-monogram">m.</span>
          <i />
          <i />
          <i />
          <i />
          <i />
        </aside>
        <main>
          <nav>
            <b>Ringkasan</b>
            <span>Oktober 2026⌄</span>
          </nav>
          <p>Data per 18 Oktober 2026</p>
          <div className="mini-metrics">
            <div>
              <small>Total pendapatan</small>
              <b>Rp24.580.000</b>
              <em>↗ 12,8% bulan ini</em>
            </div>
            <div>
              <small>Total pelanggan</small>
              <b>1.284</b>
              <em>↗ 8,2% bulan ini</em>
            </div>
          </div>
          <div className="mini-chart">
            <b>
              Statistik pendapatan <span>Mingguan⌄</span>
            </b>
            <div className="chart-grid">
              {[35, 56, 42, 71, 54, 80, 68, 91, 74, 100, 83, 112].map(
                (h, i) => (
                  <i key={i} style={{ height: h + "%" }} />
                ),
              )}
            </div>
            <div className="chart-labels">
              <span>Sen</span>
              <span>Sel</span>
              <span>Rab</span>
              <span>Kam</span>
              <span>Jum</span>
              <span>Sab</span>
            </div>
          </div>
          <div className="mini-transaction">
            <span>Transaksi terbaru</span>
            <span>Lihat semua →</span>
          </div>
          <div className="transaction-lines">
            <i />
            <i />
          </div>
        </main>
      </div>
    );
  if (type === "pos")
    return (
      <div className="template-preview mini-pos">
        <header>
          <b>
            kasir <span>pintar</span>
          </b>
          <small>Shift pagi · Meja 04</small>
          <span className="mini-pos-clock">09:41</span>
        </header>
        <div className="mini-pos-body">
          <div className="mini-pos-catalog">
            <div className="mini-pos-search">Cari produk</div>
            <div className="mini-pos-items">
              {[
                ["Kopi susu", "24.000"],
                ["Roti bakar", "18.000"],
                ["Air mineral", "6.000"],
                ["Es teh", "10.000"],
              ].map(([name, price], index) => (
                <div key={name} className={"mini-pos-item tone-" + index}>
                  <i />
                  <small>{name}</small>
                  <b>Rp {price}</b>
                </div>
              ))}
            </div>
          </div>
          <aside className="mini-pos-cart">
            <b>Pesanan</b>
            <div>
              <span>Kopi susu × 2</span>
              <small>48.000</small>
            </div>
            <div>
              <span>Roti bakar × 1</span>
              <small>18.000</small>
            </div>
            <div className="mini-pos-meta">
              <small>Subtotal</small>
              <small>66.000</small>
            </div>
            <div className="mini-pos-meta">
              <small>Pajak 10%</small>
              <small>6.600</small>
            </div>
            <div className="mini-pos-total">
              <small>Total</small>
              <b>Rp 72.600</b>
            </div>
            <span className="mini-pos-pay">Bayar</span>
          </aside>
        </div>
      </div>
    );
  if (type === "shop")
    return (
      <div className="template-preview mini-shop">
        <nav>
          <b>
            objek<span>®</span>
          </b>
          <span>Koleksi &nbsp; Tentang</span>
          <ShoppingBag size={10} />
        </nav>
        <div className="mini-shop-hero">
          <small>KERAMIK & PERABOT RUMAH</small>
          <h3>
            Keramik
            <br />
            untuk harian.
          </h3>
          <span>
            Lihat koleksi <ArrowRight size={9} />
          </span>
          <div className="vase vase-one" />
          <div className="vase vase-two" />
          <div className="vase-shadow" />
        </div>
        <div className="mini-products">
          <div>
            <i className="product-bowl" />
            <small>
              Mangkuk Terra <b>Rp129.000</b>
            </small>
          </div>
          <div>
            <i className="product-lamp" />
            <small>
              Lampu Sora <b>Rp459.000</b>
            </small>
          </div>
          <div>
            <i className="product-vase" />
            <small>
              Vas Nala <b>Rp249.000</b>
            </small>
          </div>
        </div>
      </div>
    );
  if (type === "portfolio")
    return (
      <div className="template-preview mini-portfolio">
        <nav>
          <b>nara.design</b>
          <span>
            Tersedia untuk kolaborasi <i />
          </span>
        </nav>
        <small>DESAINER INDEPENDEN · JAKARTA</small>
        <h3>
          Desain visual
          <br />
          dan <em>identitas.</em>
          <ArrowUpRight size={26} />
        </h3>
        <div className="portfolio-bottom">
          <div className="portfolio-art">
            <span>
              FORM
              <br />& FEEL
            </span>
            <i />
            <i />
            <i />
          </div>
          <div className="portfolio-note">
            <span>01 / PILIHAN KARYA</span>
            <p>
              Identitas visual
              <br />
              untuk brand.
            </p>
            <Circle size={24} />
          </div>
        </div>
      </div>
    );
  if (type === "invitation")
    return (
      <div className="template-preview mini-invitation">
        <div className="mini-invitation-frame">
          <small>Undangan pernikahan</small>
          <h3>
            Nara <em>&</em> Arya
          </h3>
          <span className="mini-invitation-date">12 · 12 · 2026</span>
          <p>Surabaya, Jawa Timur</p>
          <span className="mini-invitation-cta">Konfirmasi kehadiran</span>
          <footer>Resepsi · 18.00 WIB</footer>
        </div>
      </div>
    );
  return (
    <div
      className={
        "template-preview mini-studio " + (type === "umkm" ? "coffee" : "")
      }
    >
      <nav>
        <b>
          {type === "umkm"
            ? "kopi sore."
            : type === "invitation"
              ? "nara & arya."
              : "ruang."}
        </b>
        <span>
          Karya &nbsp; Studio &nbsp; <ArrowUpRight size={8} />
        </span>
      </nav>
      <div className="studio-copy">
        <small>
          {type === "umkm" ? "KEDAI KOPI · SURABAYA" : "STUDIO DESAIN INTERIOR"}
        </small>
        <h3>
          {type === "umkm" ? (
            <>
              Kopi untuk
              <br />
              pagi yang sibuk.
            </>
          ) : type === "invitation" ? (
            <>
              Awal cerita
              <br />
              kita bersama.
            </>
          ) : (
            <>
              Ruang yang
              <br />
              dibuat untuk
              <br />
              dipakai.
            </>
          )}
        </h3>
        <p>
          {type === "umkm"
            ? "Biji lokal, disangrai mingguan."
            : "Interior residensial dan komersial."}
        </p>
        <span>
          {type === "umkm" ? "Lihat menu" : "Lihat project"}{" "}
          <ArrowUpRight size={9} />
        </span>
      </div>
      <div className="studio-arch">
        <div className="studio-window" />
        <div className="studio-table" />
        <div className="studio-chair" />
        <div className="studio-plant">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="studio-bottom">
        <span>{type === "umkm" ? "SURABAYA · 2026" : "JAKARTA · 2026"}</span>
        <span>01 — 04</span>
      </div>
    </div>
  );
}
