# pi-chronos

Durable scheduled agent execution for Pi. Chronos stores jobs and runs in SQLite, calculates once/interval/cron schedules deterministically, and requires fingerprint-bound approval for tool and project-import jobs.

## Boundaries

Chronos guards every child tool call with an exact tool, shell, and canonical path policy. This is separate from OS sandboxing; `sandboxRequired` fails closed when no supported sandbox adapter is available. When `pi-seatbelt-sandbox` publishes an active profile through `PI_SEATBELT_PROFILE`, Chronos launches its child Pi under that profile unchanged instead of adding narrower filesystem or network rules. Secrets are resolved only at launch and redacted before persistence. No jobs run while all Pi processes are closed.

## Use

Install the package into Pi, then use the `scheduler` tool or `/chronos` command. The command accepts direct subcommands, natural-language scheduling requests, or a JSON scheduler action, for example:

```text
/chronos status
/chronos create check CI every 5 minutes and write the result to ./ci-status.md
/chronos {"action":"list","limit":20}
```

Natural-language requests are sent to Pi for interpretation with the `scheduler` tool. Always preview schedules before creation. Tool-created and project-imported jobs remain `pending_approval` until a TUI/RPC confirmation token approves the current fingerprint. JSON and print modes return `INTERACTIVE_APPROVAL_REQUIRED` rather than hanging.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm run test:coverage
npm run build
npm pack --dry-run
```

The data directory is `${PI_CODING_AGENT_DIR}/chronos/chronos.db` (with Pi's agent directory API at the extension boundary). Migrations are checksummed and applied transactionally. The scheduler uses one bounded timer, durable queued runs, SQLite occurrence uniqueness, leases, and stale-owner recovery.

## Project imports

A trusted project may provide `<CONFIG_DIR_NAME>/chronos.json`, version 1, containing at most 1,000 jobs and 1 MiB. Imports reconcile by canonical project identity and stable job key; changed definitions invalidate approval and missing definitions are disabled with `IMPORT_SOURCE_MISSING`.

Example:

```json
{
  "version": 1,
  "jobs": [
    {
      "key": "daily-report",
      "name": "Daily report",
      "prompt": "Generate the report",
      "model": "provider/model",
      "schedule": { "kind": "cron", "expression": "0 9 * * *", "timezone": "UTC" }
    }
  ]
}
```

Project trust is required before Chronos reads this file; trust never grants execution approval.

## Troubleshooting

- `INTERACTIVE_APPROVAL_REQUIRED`: approve from the TUI or RPC confirmation flow; JSON and print modes never wait for input.
- `SANDBOX_UNAVAILABLE`: the job requested an OS sandbox that is not supported or could not be initialized. With `pi-seatbelt-sandbox`, ensure its extension is active and its published profile permits the Pi executable, Chronos guard/manifest paths, the job workspace, and required provider network access. Tool and path policy remain distinct and fail closed when required.
- `DB_LOCKED`: another Pi process is using SQLite. Chronos retries through SQLite's busy timeout; inspect `/chronos health` if the condition persists.
- A missing import file disables its previously imported jobs rather than deleting their history.
