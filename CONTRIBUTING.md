# Contributing

Thanks for taking a look. This is a small codebase and the bar is straightforward: keep the core SDK-agnostic, keep medical answers grounded and safe, and keep the audit log honest.

## Setup

```bash
npm install        # Node 22.17+; installs @qvac/sdk and the toolchain
npm test           # unit tests (no model downloads, no network)
npm run typecheck  # tsc --noEmit across the workspaces
```

The first `lifeline` command downloads model weights over the QVAC registry and caches them locally. Tests do not need that; they exercise the pure logic (safety, injection guard, the engine contract against a mock, WAV headers, the topic-to-key derivation) and run offline in a second or two.

## Running it

```bash
./lifeline ask "..."                          # local
./lifeline ask --model medpsy4b --rag corpus/ "..."   # grounded medical answer
./lifeline serve --topic demo                 # host a model for peers
./lifeline ask --delegate --topic demo "..."  # borrow it
npm run demo                                  # full walkthrough
```

## Code style

- The CLI and anything in `packages/node-app` must not import `@qvac/sdk`. All SDK use lives in `packages/core`, behind the `InferenceEngine` interface and the other core modules. This boundary is the point of the design; please keep it.
- TypeScript, ES modules, two-space indent. `npm run typecheck` must pass.
- Comments should explain a non-obvious *why*, not narrate the *what*. Skip comments that restate the next line.
- Human-facing text (README, help, errors, commit messages) is plain and specific. No build-process or release-planning vocabulary.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Adding a model

Models are declared in the `MODELS` map in `packages/core/src/engine.ts`: a label, the QVAC source (a registry descriptor or a GGUF URL), the model type, and any config. Add an entry and it becomes available to `--model`. If a model needs a projection (mmproj) or special decoding, follow the existing `vision` and `medpsy4b` entries.

## Adding a capability

A new modality is usually a small core module (see `tts.ts`, `voice.ts`, `ocr.ts`, `translate.ts` for the shape: load, run, unload, return a typed result with timing), an evidence event in `logger.ts`, and a flag wired into `runAsk` in the CLI. Anything that ingests external content (a file, an image, a peer response) must be treated as untrusted: scan it with the injection guard and fence it as data, never as instructions.

## Safety changes

The disclaimer, the emergency lead, and the refuse-when-ungrounded behavior are enforced in `packages/core/src/safety.ts` and covered by tests. If you change them, update the tests and keep the disclaimer non-removable. When in doubt, fail toward "call emergency services," not toward a confident answer.

## Corpus and test assets

Anything added under `corpus/` or used as a test fixture must be public-domain or permissively licensed, and disclosed in a `SOURCE.md` next to it. Do not commit copyrighted medical text.
