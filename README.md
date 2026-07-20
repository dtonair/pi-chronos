# pi-chronos

Durable scheduled agent execution for Pi. Chronos stores jobs and runs in SQLite, calculates once/interval/cron schedules deterministically, and requires fingerprint-bound approval for tool and project-import jobs.

## Boundaries

By default, Chronos guards every child tool call with an exact tool, shell, and canonical path policy. This is separate from OS sandboxing; `sandboxRequired` creates a private run-specific `tool-subprocess-v1` profile and fails closed when it cannot be applied. The child Pi launches directly on the host for normal provider authentication; only guarded command subprocesses enter an OS profile. A trusted global mode can instead delegate built-in tool, shell, and filesystem policy to an explicitly loaded `pi-seatbelt-sandbox`; the child fails closed unless that extension publishes a readable `tool-subprocess-v1` profile. Secrets remain approval-bound, are resolved only at launch, and are redacted before persistence. No jobs run while all Pi processes are closed.

## Use

Install the package into Pi, then use the `scheduler` tool or `/chronos` command. The command accepts direct subcommands, natural-language scheduling requests, or a JSON scheduler action, for example:

```text
/chronos status
/chronos create check CI every 5 minutes and write the result to ./ci-status.md
/chronos {"action":"list","limit":20}
```

Natural-language requests are sent to Pi for interpretation with the `scheduler` tool. Always preview schedules before creation. Tool-created and project-imported jobs remain `pending_approval` until a TUI/RPC confirmation token approves the current fingerprint. JSON and print modes return `INTERACTIVE_APPROVAL_REQUIRED` rather than hanging.

Scheduled jobs disable ambient extension discovery. In the default job-policy mode, approval-bound Pi extension sources may be listed in `permissions.extensions.allowedIds`; Chronos passes each source through an explicit `--extension` argument before loading its guard last. Sources use Pi's path/npm/git syntax. Extensions execute arbitrary host-side code, so approve only trusted sources.

## Global configuration

Chronos loads trusted user-global settings from `${PI_CODING_AGENT_DIR}/chronos/config.json` (normally `~/.pi/agent/chronos/config.json`). To trust `pi-seatbelt-sandbox` globally and stop applying per-job tool, exact-shell, and filesystem-path restrictions:

```json
{
  "permissionMode": "pi-seatbelt-sandbox",
  "piSeatbeltExtension": "/Users/dt/code/pi-seatbelt-sandbox"
}
```

Use an absolute local path or another Pi extension source such as `npm:pi-seatbelt-sandbox`. In this mode Chronos explicitly loads only the configured Seatbelt extension plus its own final guard, activates all Seatbelt-supported built-in tools, and ignores each job's `tools`, `shell`, and `filesystem` restrictions during tool calls. The mode still requires normal job approval and keeps environment secrets approval-bound. The global file must be owned by the current user and not group/other-writable.

Configure Seatbelt itself in `~/.pi/agent/extensions/seatbelt.json` or `<job-working-directory>/.pi/seatbelt.json`. Seatbelt provides OS enforcement for Bash subprocesses and its own in-process policy for Pi file tools; it does not sandbox the whole Pi process.

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

## Scheduled command tools

Jobs may opt into `chronos_exec` with exact executable/argv rules and bounded `uuid`, `integer`, or `slug` slots. `chronos_atomic_write` replaces one approved report path without granting generic file writing, and `chronos_complete` supplies explicit terminal evidence. New jobs default to explicit completion; legacy stored jobs retain exact Bash and process-exit behavior until updated. Any process, output, or completion change changes the approval fingerprint.

`network.domains` is approval-bound intent; macOS Seatbelt enforces only coarse network disabled/enabled. With per-job `sandboxRequired`, the child Pi remains host-side for provider authentication while Bash and structured commands run under an independent run-specific Seatbelt profile. In global `pi-seatbelt-sandbox` mode, Chronos instead consumes the profile published inside that scheduled child session and fails closed if the profile is unavailable.

Manual Bitbucket smoke testing is opt-in only: configure a local fake or the installed `bitbucket-cli`, create a job with a private config read root, exact list/get rules, an approved `PIPELINE_STATUS.md` atomic output, and explicit completion. Do not place credentials in prompts, argv, fixtures, or logs; automated tests use the deterministic fake fixture.

## Troubleshooting

- `INTERACTIVE_APPROVAL_REQUIRED`: approve from the TUI or RPC confirmation flow; JSON and print modes never wait for input.
- `SANDBOX_UNAVAILABLE`: the requested run-specific or globally delegated OS sandbox is unavailable. Tool/path policy and OS command isolation remain distinct, and network domains are approved intent while Seatbelt enforcement is coarse network off/on.
- `DB_LOCKED`: another Pi process is using SQLite. Chronos retries through SQLite's busy timeout; inspect `/chronos health` if the condition persists.
- A missing import file disables its previously imported jobs rather than deleting their history.
