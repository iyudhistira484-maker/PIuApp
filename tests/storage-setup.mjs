// Unit tests run in Node; use the Web Storage interface without browser warnings.
if (typeof globalThis.localStorage === "undefined") {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: (k) => values.delete(k),
    clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
}
