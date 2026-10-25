import { readFileSync } from "node:fs";
export const catalog = JSON.parse(
  readFileSync(new URL("./catalog-data.json", import.meta.url), "utf8"),
);
const matches = catalog
  .flatMap((service) => service.aliases.map((alias) => ({ service, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);
export function identify(name) {
  const value = name.toLowerCase();
  return matches.find(({ alias }) => value.includes(alias))?.service || null;
}
