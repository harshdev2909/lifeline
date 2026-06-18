# Submission checklist

Work top to bottom on the day of submission. The early-bird window has passed —
submit before the final deadline.

## Repo
- [x] Public GitHub repo
- [x] Apache-2.0 LICENSE, correct holder/year (Copyright 2026 Harsh Sharma)
- [x] `core` is the only `@qvac/sdk` importer (verified)
- [x] `remote-apis.yaml` present and accurate (incl. capability-suite models)
- [x] Prior-work / reuse disclosure in README
- [x] No AI co-author trailers; conventional commits; real author
- [x] `.env` gitignored and untracked (no secrets committed)
- [ ] Final `git push` so the public repo matches what was demoed

## Evidence
- [x] Committed sample logs under `examples/logs/` (grounded, delegated, fallback, refusal, vision, voice, injection, comparison)
- [x] Canonical demo flow documented with evidence mapping ([`docs/demo.md`](../docs/demo.md))
- [ ] Attach the device hardware screenshot (System Profiler / `npm run sysinfo`) for every device used in the demo — see below

## Quality gates (re-run before recording)
- [ ] `npm run typecheck` clean
- [ ] `npm test` green (66 tests)
- [ ] `npm run build --workspace @lifeline/web` clean
- [ ] Fresh-clone reviewer path works offline once weights are cached (`npm test` + `npm run ui`)
- [ ] No orphaned SDK workers after the full demo flow (Ctrl-C leaves nothing running)
- [ ] reduced-motion, keyboard nav, AA contrast still pass

## Hardware capture (do this on each demo device)
- [ ] `npm run sysinfo` → paste the CPU/GPU/RAM/storage into `submission/hardware.md`
- [ ] Screenshot of the OS system profiler, saved to `submission/`
- [ ] Note: this dev machine is 16 GB — video OOMs here; the ≥20 GB peer path is the real one

## Video
- [ ] Recorded in airplane mode, under 5 minutes, leads with delegated inference + fallback
- [ ] App-layer-transport caption shown during the incident/responder beat
- [ ] Disclaimer visible at least once and on the end card
- [ ] Uploaded unlisted to YouTube, link pasted into `submission/form.md` and the form

## Submission form (DoraHacks)
- [ ] Project name + one-line description (from `form.md`)
- [ ] Short + long description
- [ ] Track: General Purpose + Psy Models (mesh = Tinkerer/Mobile narrative)
- [ ] "How we use QVAC" section (the full stack, each with its real use case)
- [ ] Prior-work statement
- [ ] Repo link + unlisted video link
- [ ] Every team member added to the DoraHacks project page (not just the form)

## Awareness
- [ ] Build-in-public thread published (`build-in-public.md`) with the official hashtag confirmed
