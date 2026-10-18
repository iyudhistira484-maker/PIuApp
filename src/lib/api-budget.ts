/**
 * How long the client is willing to wait for each kind of API call.
 *
 * Ordinary calls cannot hang the UI forever, but the paid, slow ones need a
 * budget that matches what they really do. This is kept apart from the fetch
 * wrapper so the budgets are tested instead of trusted: a timeout that fires
 * mid-way reports "hasil belum terkonfirmasi", which is the worst possible
 * answer for work that has already landed on the server.
 */
export const API_TIMEOUT_DEFAULT = 30_000;
/** A Lighthouse audit runs a real browser in a sandbox on a real build. */
export const API_TIMEOUT_AUDIT = 480_000;
/** Building, packaging, and handing a model to Roblox Open Cloud. */
export const API_TIMEOUT_LONG = 180_000;

export function apiTimeoutMs(path: string) {
  // A query string names the same operation (the plugin polls an upload with
  // `?operation=…`), so it must not change the budget.
  const route = path.split(/[?#]/)[0];
  // Audits are the longest: install, build, serve, then Lighthouse.
  if (/\/audit$/.test(route)) return API_TIMEOUT_AUDIT;
  // Uploading a GLB to Roblox is a multipart POST the server relays to Open
  // Cloud, with a file up to 12 MB. At the 30 s default the user was told the
  // upload was unconfirmed while it had in fact gone through.
  if (/\/studio\/assets$/.test(route)) return API_TIMEOUT_LONG;
  if (/\/(?:sandbox\/(?:command|preview|files)|packages)$/.test(route))
    return API_TIMEOUT_LONG;
  return API_TIMEOUT_DEFAULT;
}
