# @icjia/filecap

**File inventory CLI for accessibility audit scoping.**

`filecap` walks a directory tree, introspects each file (with deep-dive support for PDFs and Office documents), and produces a structured NDJSON inventory suitable for accessibility remediation scoping. The primary use case is generating a per-server inventory of file stores — Strapi `/uploads` directories, general-purpose file servers — to hand to remediation vendors so they can produce a defensible, fixed-price quote on ADA Title II / WCAG 2.1 AA remediation work.

## Status

**Design phase.** No code has been implemented yet. The full design specification lives at [`docs/filecap-design.md`](docs/filecap-design.md).

Implementation is planned in eight phases, each shipping as a complete, testable npm release:

| Phase | Version | Deliverable |
|---|---|---|
| 1 | v0.1.0 | Core scan — recursive walk, hashing, NDJSON output |
| 2 | v0.2.0 | PDF introspection (image-only flag, tags, producer, signatures, language) |
| 3 | v0.3.0 | Office introspection (DOCX, XLSX) |
| 4 | v0.4.0 | Filename flagging |
| 5 | v0.5.0 | Multi-server rollup |
| 6 | v0.6.0 | CSV reporter and summary artifacts |
| 7 | v1.0.0 | MCP server entry point (deferred) |
| 8 | vNext | Strapi-aware mode (separate package) |

## Intended Workflow

```bash
# Per server (run via SSH on each instance):
npx @icjia/filecap scan /var/strapi/uploads
# → writes filecap-<hostname>.ndjson in cwd

# On the primary machine, after scp'ing NDJSONs back:
filecap rollup ~/inventories/*.ndjson -o consolidated.ndjson
filecap report consolidated.ndjson -o ./report/
# → SUMMARY.txt, files.csv, largest_files.txt, pdf_image_only.txt, etc.
```

The `files.csv` work-order is suitable for direct handoff to a remediation vendor; summary text artifacts give ICJIA leadership the headline numbers (file counts, image-only PDF counts, total volume, duplicate consolidation savings).

## What filecap Does Not Do

filecap reports *what files exist and their structural accessibility characteristics*. It does not:

- Perform full WCAG conformance auditing of files (that's [audit.icjia.app](https://audit.icjia.app)'s job, per-file)
- Remediate, fix, or modify any files
- Track vendor remediation status or workflow (out of scope — the NDJSON inventories are themselves the time-series record)
- Integrate directly with the Strapi API (deferred to Phase 8 in a separate package)

## License

[MIT](LICENSE) © Illinois Criminal Justice Information Authority

## Related @icjia tools

filecap is the inventory-side complement to ICJIA's audit tooling:

- `@icjia/viewcap` — screenshot capture (MCP)
- `@icjia/lightcap` — Lighthouse audits (MCP)
- `@icjia/axecap` — axe-core accessibility audits (MCP)
- `@icjia/contrastcap` — color contrast auditing (MCP)
- `audit.icjia.app` — full WCAG conformance auditing (per-file)
