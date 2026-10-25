import catalogData from "./catalog-data.json" with { type: "json" };
export const catalog = catalogData;
const matches = catalog
  .flatMap((service) => service.aliases.map((alias) => ({ service, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);
export function identify(name) {
  const value = name.toLowerCase();
  return matches.find(({ alias }) => value.includes(alias))?.service || null;
}
