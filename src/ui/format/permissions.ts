import type { JobPermissions } from "../../domain/permission.js";
import { boundList } from "../layout.js";

export interface PermissionRow {
  label: string;
  value: string;
}

/** Render capability names only; environment values are intentionally absent. */
export function formatPermissions(permissions: JobPermissions, maxItems = 4): PermissionRow[] {
  return [
    { label: "Tools", value: boundList(permissions.tools, maxItems) },
    {
      label: "Shell",
      value: permissions.shell.allowed ? boundList(permissions.shell.commands, maxItems) : "denied",
    },
    ...(permissions.process === undefined
      ? []
      : [
          {
            label: "Process",
            value: permissions.process.allowed
              ? boundList(permissions.process.commands.map(formatProcessCommand), maxItems)
              : "denied",
          },
        ]),
    { label: "Read", value: boundList(permissions.filesystem.readPaths, maxItems) },
    { label: "Write", value: boundList(permissions.filesystem.writePaths, maxItems) },
    {
      label: "Network",
      value: permissions.network.allowed
        ? boundList(permissions.network.domains, maxItems)
        : "denied",
    },
    { label: "Extensions", value: boundList(permissions.extensions.allowedIds, maxItems) },
    { label: "Secrets", value: boundList(permissions.secrets.allowedNames, maxItems) },
  ];
}

function formatProcessCommand(
  command: NonNullable<JobPermissions["process"]>["commands"][number],
): string {
  return [
    command.executable,
    ...command.args.map((arg) => (arg.kind === "literal" ? arg.value : `<${arg.name}>`)),
  ].join(" ");
}
