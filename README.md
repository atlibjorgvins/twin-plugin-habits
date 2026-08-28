# twin-plugin-habits

Daily habit tracking with streaks — a [twin](https://github.com/atlibjorgvins/twin)
plugin, extracted to its own repo to prove the GitHub ingest loop.

## What this is

A **build-time twin plugin**. The repo's contents are cloned into twin at
`src/lib/plugins/habits/` and compiled into the bundle — there is no runtime
loader (twin is a static SPA). "Installing" = adding this repo to twin and
redeploying. See twin's
[`docs/plugin-contract.md`](https://github.com/atlibjorgvins/twin/blob/main/docs/plugin-contract.md).

| File | Role |
| --- | --- |
| `manifest.ts` | The `PluginManifest` — id, label, routes, collections. |
| `data.ts` | Data access, through twin's neutral `repo` port (never `@directus/sdk`). |
| `plugin.json` | Marketplace metadata (id, api version, collections, routes). |

`manifest.ts` / `data.ts` import from twin's `$lib` (`../types`, `$lib/data/repo`),
so this repo is authored **against twin's contract** and is meant to be cloned
into twin — it does not typecheck standalone. A standalone SDK is a future twin
milestone.

## Install into a twin instance

1. Add an entry to twin's `plugins.json`:

   ```json
   { "external": [ { "id": "habits", "repo": "https://github.com/atlibjorgvins/twin-plugin-habits", "ref": "main" } ] }
   ```

2. Materialise it and redeploy:

   ```bash
   bash scripts/fetch-plugins.sh
   bash scripts/deploy.sh --target <instance>
   ```

`fetch-plugins.sh` clones this repo (at the pinned `ref`) into
`src/lib/plugins/habits/`; `deploy.sh` runs it automatically before every build.

## Storage

Owns the `habit` and `habit_entry` Directus collections. The consuming twin
instance provides them (twin ships the schema scripts).
