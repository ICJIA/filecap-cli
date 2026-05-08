# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial design document at `docs/filecap-design.md` covering scope, motivation, architecture, NDJSON schema, CLI interface, file-type introspection, tech stack, phased delivery plan, and resolved decisions.
- Project metadata: `README.md`, `LICENSE` (MIT), `.gitignore`, `CHANGELOG.md`.

### Design decisions locked

- **Output format.** NDJSON (`.ndjson`) for both single-instance scans and consolidated rollups. Header line + one entry per file + footer line carrying dynamic stats. Streamed write, streamed read.
- **Rollup canonical-row semantics.** One row per physical copy in the consolidated inventory; content-duplicates carry a `duplicateOf` field pointing to the canonical entry (oldest `modifiedAt`, alphabetical tiebreaker on `serverName`).
- **PDF introspection failure handling.** Empty fields, no stub error block — when `pdfjs-dist` throws, the entry's `introspection` key is omitted entirely.
- **Hash algorithm.** SHA-256 via Node's native `crypto` module. Native crypto outperforms any pure-JS alternative under the no-native-deps constraint.
- **Vendor workflow.** Out of scope. filecap is a pure inventory tool. No vendor-fill CSV columns, no protocol negotiation, no diff/reconcile commands in v1.
- **CSV column additions.** `category`, `remediable`, `documentLanguage`, `pdfHasFormFields`, `pdfHasSignatures`, `pdfProducer`, `pdfCreator`, `pdfCreationDate`, `docxImageCount`.
