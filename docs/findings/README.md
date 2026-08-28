# CMS entries published but not rendered on the live site

**Found:** 2026-08-27, during the v1.65.0 page-reference fix.
**Scope:** 25 content entries carrying 28 files.

## What this is

Each row is a CMS entry that is **published** (its API record says so) but whose
page does **not** render on the live website — every `pageUrl` here was verified
live and returned a non-200. The files attached to those entries are therefore
**unreachable to the public**, even though the CMS presents them as available.

This is **not** an audit defect. The v1.65.0 route fix corrected the audit's own
URL construction, and after it 1,745 of 1,747 resolved page URLs return 200. These
are the remainder: the audit is now describing the sites accurately, and what it
is describing is a content problem on the sites themselves.

## Breakdown

| Site | Entries | 
|---|---|
| Illinois Family Violence Coordinating Council | 24 |
| Adult Redeploy Illinois | 1 |

## Likely cause

Neither CMS exposes a field that distinguishes these entries from the ones that do
render — same content type, same publication flag, same tags. The most probable
explanation is a build-time filter on the front end (for example, dropping events
whose date has passed) that the API does not reflect. The site teams can confirm;
the audit cannot infer it.

## What to do with it

Send `2026-08-27-cms-entries-not-rendered.csv` to the owning site team. For each
row they decide whether the page *should* render (a build bug) or the entry should
be unpublished (content housekeeping). Either resolves the mismatch.

## Columns

`site`, `contentType`, `slug`, `pageUrl`, `httpStatus` (as measured 2026-08-27),
`fileCount`, `fileUrls`.
