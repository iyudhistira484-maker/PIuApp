// Bundle the canonical migrations without nested transactions. Never run this against a database.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../supabase/", import.meta.url);
const names = readdirSync(root)
  .filter((n) => /^\d{3}_.+\.sql$/.test(n))
  .sort();
if (
  names.length !== 16 ||
  names.some((n, i) => !n.startsWith(String(i + 1).padStart(3, "0") + "_"))
)
  throw new Error("Tinjau urutan migration sebelum memperbarui installer.");
const sources = names.map((name) => ({
  name,
  text: readFileSync(new URL(name, root), "utf8"),
}));
const tables = [
  ...new Set(
    sources.flatMap(({ text }) =>
      [
        ...text.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g),
      ].map((m) => m[1]),
    ),
  ),
];
const content =
  `-- PIWUAPP: INSTALL BARU SAJA (001–016)
-- Dibuat oleh npm run sql:bundle dari migration kanonis; jangan edit hasil ini manual.
-- Jalankan SELURUH file di SQL Editor project Supabase baru sebagai operator database.
-- BUKAN untuk database yang pernah menerima migration PiwuApp.
-- Tidak membuat akun Auth, password, admin, pembayaran, atau kredensial provider.
-- Semua perubahan berada dalam satu transaksi: kegagalan membatalkan instalasi.
begin;
select pg_advisory_xact_lock(71008,1);
do $piwu_preflight$
begin
  if to_regclass('auth.users') is null or to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'PIWU_SUPABASE_REQUIRED: gunakan project Supabase dengan Auth dan Storage tersedia';
  end if;
  if exists (select 1 from unnest(array[${tables.map((t) => `'public.${t}'`).join(",")}]) as candidate(name) where to_regclass(name) is not null) then
    raise exception 'PIWU_EXISTING_DATABASE: objek PiwuApp sudah ada. Jangan jalankan installer baru; periksa CHECK_INSTALLATION.sql dan jalankan hanya migration yang belum diterapkan.';
  end if;
  if exists(select 1 from storage.buckets where id='project-assets') then
    raise exception 'PIWU_EXISTING_BUCKET: bucket project-assets sudah ada; tinjau database lama sebelum instalasi';
  end if;
end $piwu_preflight$;

` +
  sources
    .map(({ name, text }) => {
      if (!/^begin;$/m.test(text) || !/commit;\s*$/.test(text))
        throw new Error("Batas transaksi tidak dikenali: " + name);
      const hash = createHash("sha256").update(text).digest("hex");
      return (
        `-- =====================================================================\n-- ${name} | SHA256 ${hash}\n-- =====================================================================\n` +
        text
          .replace(/^begin;\r?\n/m, "")
          .replace(/commit;\s*$/, "")
          .trim() +
        "\n"
      );
    })
    .join("\n") +
  "\nnotify pgrst, 'reload schema';\ncommit;\n\nselect 'Instalasi skema 001–016 selesai. Jalankan CHECK_INSTALLATION.sql, lalu bootstrap admin secara terpisah.' as hasil;\n";
const target = new URL("install/INSTALL_NEW_DATABASE.sql", root);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== content)
    throw new Error(
      "Installer berbeda dari migration. Jalankan npm run sql:bundle.",
    );
  console.log("SQL bundle sesuai migration 001–016.");
} else {
  mkdirSync(new URL("install/", root), { recursive: true });
  writeFileSync(target, content);
  console.log("Dibuat: supabase/install/INSTALL_NEW_DATABASE.sql");
}
