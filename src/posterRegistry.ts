const posterModules = import.meta.glob("../assets/imported-posters/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const byName = new Map<string, string>();

for (const [path, url] of Object.entries(posterModules)) {
  const name = path.split("/").pop();
  if (name) byName.set(name, url);
}

export function posterByName(name: string) {
  return byName.get(name) || "";
}

export function normalizeLegacyAssetUrl(src?: string) {
  if (!src) return "";
  const name = src.split("/").pop() || "";
  if (/^(\.\/)?assets\/imported-posters\//.test(src)) return posterByName(name) || src;
  return src;
}
