# Brand assets

The catalog contains 120 recognizable service/brand names and associated logos. No generated letter marks are used as merchant logos. Unknown merchants use a neutral payment-account icon, not an invented brand mark.

- Canonical brand SVG paths are sourced from the installed Simple Icons package, with each asset's underlying source URL recorded as `logoSource` in `server/catalog-data.json`.
- Other brand/service favicons were retrieved from the corresponding official domains through Google's favicon cache at build time. They are stored locally; viewing the catalog does not send the user's service list to Google.
- The HBO Max icon is from its official site's apple-touch icon.
- Native PNG renditions use the same source assets; `mobile/brand-logos.js` maps every catalog ID to its bundled PNG.
- Simple Icons' CC0 license is included in `docs/simple-icons-LICENSE.md`. Brands retain their trademarks and brand-specific terms. Some marks identify a brand family rather than an individual paid plan.
- `logoSource` records provenance; inclusion does not establish a partnership, endorsement, subscription availability or API support. Availability varies by region and merchant. Plan prices are not invented or hardcoded in the catalog.

Asset names and merchant aliases are versioned with the source. Update brand changes deliberately rather than relying on client-side hotlinks. The browser suite checks that all catalog images load from local assets.
