# pi-chronos architecture

- `src/domain` contains host-independent contracts; `src/api` validates external envelopes.
- `src/storage` is the durable source of truth. Migrations are numbered, checksummed, and transactional. Repository writes use parameterized SQL and revision/occurrence compare-and-set semantics; composed application transactions use SQLite savepoints.
- `src/scheduler` is pure calculation plus transactional dispatch. A runtime has one timer, one scheduler instance, bounded execution pump, lease coordinator, and idempotent shutdown. SQLite remains authoritative across restarts.
- `src/security` is a fail-closed child guard. Tool/path policy and OS sandbox status are disclosed separately; the platform adapter probes macOS `sandbox-exec` and fails closed elsewhere.
- `src/execution` launches Pi without a shell, sends prompts through stdin, parses bounded JSONL, redacts output, persists private artifacts, and cleans process groups. Terminal run persistence and job counters commit atomically.
- `src/extension` is the Pi boundary. Factories register static metadata only; database/timers/children start at `session_start` and stop at `session_shutdown`. Reload and session replacement are terminal for the old runtime. Trusted imports reconcile in one transaction and disable source jobs when their file disappears.

Run `npm run check`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run build`, `npm audit --audit-level=high`, and `npx tsx test/bench/due-query.ts`. Use `npm_config_cache=/tmp/pi-chronos-npm-cache npm ci --ignore-scripts` when the user npm cache has ownership issues. Do not weaken approval, ownership, lease, canonical-path, or migration checks to make tests pass.
