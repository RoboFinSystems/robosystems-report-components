---
description: Monitor a release/publish run — diagnose failures, verify the package landed and loads.
argument-hint: '[run-id]'
---

Monitor a release and publish run — pinpoint why it failed, and confirm the version actually landed on npm in a state consumers can load.

## How a release actually happens here

One workflow, `create-release.yml` (manual dispatch with `major|minor|patch`, or `npm run release:create [type]`), with three jobs in sequence:

1. **`create-release`** — bumps the version on `main` and creates `release/<version>` (the script also checks it out locally).
2. **`create-tag`** — `tag-release.yml` tags it and cuts the GitHub Release.
3. **`publish`** — runs once the tag exists, under the `production` environment, so its required-reviewer prompt lands on this same run. Checks out the tag, verifies the version is the one just cut, builds, and runs `npm publish --provenance`. npm's trusted publisher is registered against `create-release.yml` and the `production` environment.

So **merging a PR to `main` publishes nothing** — dispatching the workflow is the publishing event, and nothing uploads until the deployment is approved on the run page. A failed publish is retried with **Re-run failed jobs** on that run; the version and tag are already cut, and a new release is warranted only when the code itself is at fault.

**Curated release notes are supported here.** `tag-release.yml` auto-generates a changelog from changes since the last tag via the Claude API, but if `.github/release-notes/v<version>.md` exists **at the tagged ref**, it replaces the generated changelog and the stats section is skipped. The file must be committed to `main` _before_ dispatching `create-release.yml` — see `/release-notes`, and note there is no window to add it afterwards.

## Scope & guardrails

- **`gh` reads are free; triggering a release is not.** Reading runs, jobs, and logs needs no confirmation. **Dispatching `create-release.yml`** is outward-facing and effectively irreversible — an npm version cannot be unpublished after 72 hours, and unpublishing breaks consumers. Confirm the bump type and ref with the user; default to watching a run they already started.
- **Never bump `version` in `package.json` by hand.** The workflow owns it.
- **A breaking release is a two-consumer event.** `roboledger-app` and `xbrlkit-viewer` both use this in production, and renames or removals are breaking **even pre-1.0**. If the change set carries one, say so and stop rather than dispatching.
- **Curated notes must already be merged.** If this release deserves them and the file isn't on `main` yet, dispatching now permanently gets the generated changelog instead.

## 1. Find the run

```bash
gh run list --workflow=create-release.yml --limit 5
gh run view <run-id>
gh run watch <run-id>            # live, if in flight
```

## 2. Pinpoint the failure

```bash
gh run view <run-id> --log-failed
```

- **`create-release.yml` — branch already exists.** A previous run got partway; resolve the leftover `release/<version>` branch rather than re-dispatching blindly.
- **`create-release.yml` — push to `main` rejected.** The bump commits to a protected branch; a permissions failure shows at the push step.
- **`tag-release.yml` — changelog step.** A failed Claude API call falls back to a mechanical summary rather than failing the run. Notes that read like a commit tally usually mean the fallback fired — or that a curated file was expected and wasn't found at the tagged ref.
- **`publish` — waiting.** The job is paused on the `production` environment's required reviewer. Nothing is wrong; approve it from the run page (_Review deployments_).
- **`publish` — "checked out version X, expected Y".** The tag the job checked out does not carry the version this run cut. Nothing was published; look at what `create-tag` tagged.
- **`publish` — build.** `tsup` over two entries. This is where packaging breaks surface.
- **`publish` — the upload.** `npm publish --provenance` over OIDC. Failures are usually npm-side trust configuration (the publisher must name `create-release.yml`) or a name/version mismatch, not code.
- **Version already on npm.** Every later step is skipped rather than overwriting. If you expected a publish, the version wasn't bumped.

## 3. Verify it actually landed

A green workflow is not proof:

```bash
npm view @robosystems/report-components version           # latest published
npm view @robosystems/report-components versions --json   # full history
```

Then confirm the artifact is shaped right and — the check that matters most for this package — **that it actually loads**:

```bash
npm pack @robosystems/report-components@<version> --dry-run   # only dist/, README, LICENSE should ship
```

The published output must be valid ESM that Node's native resolver can load. That's the entire reason the build is `tsup` rather than `tsc` (see `tsup.config.ts`), and CI guards it with a "Verify dist loads under Node ESM" step. If that step was skipped or the build config changed in this release, verify by hand:

```bash
node --input-type=module -e "import('@robosystems/report-components').then(m => console.log(Object.keys(m).length + ' exports'))"
node --input-type=module -e "import('@robosystems/report-components/adapters').then(m => console.log(Object.keys(m).length + ' adapter exports'))"
```

Both entries must resolve — `.` and `./adapters`. An extensionless-import regression fails here and nowhere earlier.

Then adoption:

```bash
cd ../roboledger-app && npm install @robosystems/report-components@<version> && npm run test:all
```

## Output

A short status: which job, what failed and at which step, the root cause, the re-run link if any, the verified published version, whether both entries load under Node ESM, and whether the notes that shipped were curated or generated. If nothing failed, say so — don't manufacture work.

$ARGUMENTS
