export function downloadBytes(
  name: string,
  bytes: Uint8Array,
  type = "model/gltf-binary",
) {
  // Copied into a fresh buffer so the Blob never keeps the whole transferable
  // alive, and revoked late enough for the browser to start the download.
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadText(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
