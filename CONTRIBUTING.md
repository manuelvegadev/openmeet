# Contributing to OpenMeet

## Commits

### Conventional Commits

Every commit message follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary>

<body: what changed and why, wrapped at ~72 columns>
```

Types used in this repo:

| Type | Use for |
|------|---------|
| `feat` | A user-visible feature or capability |
| `fix` | A bug fix |
| `perf` | A performance improvement with no behaviour change |
| `refactor` | Code change that is neither a feature nor a fix |
| `build` | Dependencies, bundling, TypeScript/Biome configuration |
| `ci` | GitHub Actions workflows |
| `docs` | Documentation only (README, CLAUDE.md, docs/) |
| `test` | Tests and test tooling (smoke scripts) |
| `chore` | Releases, housekeeping that fits nowhere else |

Scopes are the package or area touched: `go`, `server`, `shared`, `website`, `deps` (`terminal` for the retired Node client). Omit the scope when a change spans the whole repo.

- Summary in imperative mood, lower case, no trailing period, under 72 characters.
- Use `!` after the type/scope (and a `BREAKING CHANGE:` footer) for anything that breaks the signaling protocol or a published CLI flag.
- A release is `chore(go): release x.y.z` bumping `packages/go/VERSION`, tagged `vx.y.z` (see "Releasing" in packages/go/README.md).

### Atomic commits

One logical change per commit. A commit should be understandable and revertable on its own:

- Separate dependency upgrades from the code that uses them.
- Separate a refactor from the feature it enables.
- Keep documentation for a change in the same commit when it is small, or in its own `docs:` commit when the change is large.
- Do not mix unrelated fixes into a feature commit, even if they were found along the way.
- Stage by file or hunk (`git add -p`) rather than `git add -A` when the working tree holds more than one change.

## Branches

Work on a branch named after the change: `feat/windows-audio`, `fix/glare-retry`, `docs/contributing`. `main` receives merges of finished, verified work.

## Before you push

```bash
pnpm lint                                        # Biome, for the server, shared and website
pnpm build                                       # shared → server
(cd packages/go && gofmt -l . && go vet ./... && go test ./...)   # the client, golden frames included
packages/go/scripts/build.sh && packages/go/openmeet --list-devices   # on a machine with audio devices
```

For audio or WebRTC changes, also run a real two-client call (see the test rig notes in CLAUDE.md) with `--debug`: late pump ticks, underruns and reopen counts in the debug panel must not regress.

## Releases

The changelog follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the
version follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Two rules from
those specs decide almost everything here: **a changelog is for humans, not machines**, and
**every version gets an entry**.

`CHANGELOG.md` at the repository root is the record. The GitHub release notes are a copy of
that version's section — not a second, different text — because a release page only exists
inside GitHub, while the file travels with the repository and with the source tarball.

### Writing an entry

Add to the `## [Unreleased]` section as the work lands, rather than reconstructing a release
from its commits afterwards. Group changes under the six headings the spec defines, in this
order, omitting the ones with nothing in them:

`Added` · `Changed` · `Deprecated` · `Removed` · `Fixed` · `Security`

An entry is **prose, written for someone using the app**, not a commit subject. One or two
sentences: what changed for them, and — where a bug is involved — the symptom first, so that
whoever hit it recognises it in the first line. Several commits that together fixed one thing
are one entry; a commit that changed nothing a user can see is not an entry at all.

The commit bodies are where the material comes from. They already carry the symptom, the
measurement and the reason; an entry is that, rewritten for someone who was not there.

What the spec tells us not to do, and why each one applies here:

- **No commit log dumps.** Merge commits, `chore:` bumps and refactor subjects are noise to a
  reader who wants to know whether to update. This is also why `go-client.yml` does not
  generate the notes: GitHub's generated notes list merged pull requests, and this repository
  commits straight to `main`, so they arrive empty — which is correct, the job should not be
  writing them.
- **Never omit a deprecation or a breaking change.** The client updates itself, so a user can
  arrive at a new version without having chosen it. Anything that changes a flag, a settings
  key, the `settings.json` shape or the signaling protocol goes in the entry explicitly, with
  what to do about it.
- **ISO 8601 dates** (`YYYY-MM-DD`), the tag's own date.
- **Do not quietly drop a release.** A version that shipped no changes says so — 0.6.1 exists
  to have exercised the updater, and its entry says exactly that. A pulled release keeps its
  section and is marked `[YANKED]`.

Pre-1.0, SemVer clause 4 means anything may change at any time, so the version number is not a
promise. The changelog is the only thing telling a user what a version did — which is what
makes it worth writing properly rather than generating.

### Publishing

```bash
echo X.Y.Z > packages/go/VERSION
$EDITOR CHANGELOG.md            # rename [Unreleased] to [X.Y.Z] - <date>, add the compare link
git commit -am "chore(go): release X.Y.Z"
git tag vX.Y.Z
git push && git push --tags     # go-client.yml builds both binaries and creates the release
```

Then copy that version's section into the release, which the workflow leaves empty. This lifts
the section without its own heading (the release page already shows the version and the date)
and stops at the next one:

```bash
V=X.Y.Z PREV=vA.B.C
{ awk -v v="$V" 'BEGIN{p="^## \\["v"\\]"} $0~p{f=1;next} f&&/^(## \[|---$)/{exit} f' CHANGELOG.md
  echo "**Full Changelog**: https://github.com/manuelvegadev/openmeet/compare/$PREV...v$V"
} | gh release edit "v$V" --notes-file -
```

The compare link goes last so the diff is still one click away for anyone who does want the
commits. Read the release page afterwards — it is the copy most people see.
