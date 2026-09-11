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
