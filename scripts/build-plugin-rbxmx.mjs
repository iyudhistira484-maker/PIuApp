// Wrap public/plugins/PiwuStudio.luau in an .rbxmx a user can drop straight into
// the Studio "Plugins" folder, so installing the bridge is one download instead
// of copying source into a temporary Script. The .luau file stays the source of
// truth: this script only wraps it, and tests/studio-plugin.test.ts fails when the
// committed .rbxmx drifts from it (npm run plugin:check does the same by hand).
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const source = new URL("../public/plugins/PiwuStudio.luau", import.meta.url);
const target = new URL("../public/plugins/PiwuStudio.rbxmx", import.meta.url);

/** CDATA cannot contain "]]>", so a stray "]]" is split across two sections. */
function cdata(text) {
  return "<![CDATA[" + text.split("]]").join("]]]]><![CDATA[>") + "]]>";
}

export function buildPluginRbxmx(luau) {
  if (!luau.includes("local VERSION = "))
    throw new Error("Sumber plugin tidak mengenali versinya sendiri.");
  return (
    `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n` +
    `\t<Item class="Script" referent="RBX0">\n` +
    `\t\t<Properties>\n` +
    `\t\t\t<string name="Name">PiwuStudio</string>\n` +
    `\t\t\t<bool name="Disabled">false</bool>\n` +
    `\t\t\t<ProtectedString name="Source">${cdata(luau)}</ProtectedString>\n` +
    `\t\t</Properties>\n` +
    `\t</Item>\n` +
    `</roblox>\n`
  );
}

const luau = readFileSync(source, "utf8");
const version = /local VERSION = "([\d.]+)"/.exec(luau)?.[1];
const content = buildPluginRbxmx(luau);

if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== content)
    throw new Error(
      "PiwuStudio.rbxmx berbeda dari sumber .luau. Jalankan npm run plugin:rbxmx.",
    );
  console.log(`PiwuStudio.rbxmx sesuai sumber .luau (versi ${version}).`);
} else {
  writeFileSync(target, content);
  console.log(
    `Dibuat: public/plugins/PiwuStudio.rbxmx (versi ${version}, SHA256 sumber ${createHash("sha256").update(luau).digest("hex").slice(0, 12)})`,
  );
}
