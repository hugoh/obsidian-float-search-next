# Contributing

Issues and pull requests are welcome. PR titles must follow
[Conventional Commits](https://www.conventionalcommits.org) (`feat: …`,
`fix: …`), which CI checks. PRs are squash-merged, so the title becomes the
commit message and the changelog entry.

## Development

Tooling is managed by [mise](https://mise.jdx.dev) (Bun, hk and the linters):

```sh
mise install
bun install
bun run dev        # rebuild main.js on change
bun run test       # unit tests (bun) and regression tests (node)
bun run test:e2e   # builds, then runs the plugin in a real Obsidian
bun run lint       # eslint-plugin-obsidianmd, the rules the plugin review applies
bun run typecheck  # plugin, unit tests and e2e specs
bun run build      # typecheck + production bundle
hk check --all     # everything CI runs
```

`test:e2e` downloads Obsidian into `.obsidian-cache/` (gitignored) and uses
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service).
It tests the latest release; set `OBSIDIAN_VERSIONS` (for example
`"earliest/earliest latest/latest"`) to test others.

## Releasing

Obsidian requires the release tag to equal `manifest.json`'s `version` (with no
`v` prefix), and it reads that version from the default branch. Releases are
driven by [release-please](https://github.com/googleapis/release-please) from
Conventional Commits: it keeps a release PR that bumps `manifest.json` and
`package.json`. Merging it tags the release and opens a draft; the `release`
workflow builds with a frozen lockfile, runs the tests and lint, attests
`main.js`, attaches `main.js` and `manifest.json`, and only then publishes the
draft, so Obsidian never sees a version without assets.

The workflow needs a GitHub App (so the release PR triggers CI): set the
repository variable `RELEASE_APP_CLIENT_ID` and the secret
`RELEASE_APP_PRIVATE_KEY`.
