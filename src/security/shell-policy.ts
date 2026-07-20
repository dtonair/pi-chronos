import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { JobPermissions } from "../domain/permission.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

const NETWORK_COMMANDS = /(^|\s)(curl|wget|fetch|nc|netcat|ncat|ssh|scp|sftp|ftp)(\s|$)/i;
const URL_PATTERN = /\bhttps?:\/\/([^\s/:'"`]+)(?::\d+)?(?:[/?#\s]|$)/gi;

/** Exact complete-string shell authorization; patterns are intentionally unsupported. */
export function checkShellCommand(command: string, permissions: JobPermissions): Result<void> {
  if (!permissions.shell.allowed) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.PERMISSION_DENIED,
        message: "Shell execution is denied",
      }),
    );
  }
  if (!permissions.shell.commands.includes(command)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.PERMISSION_DENIED,
        message: "Shell command is not allowlisted",
      }),
    );
  }
  return checkNetworkDestination(command, permissions);
}

function checkNetworkDestination(command: string, permissions: JobPermissions): Result<void> {
  const urls = [...command.matchAll(URL_PATTERN)].map((match) => match[1]?.toLowerCase());
  const networkCommand = NETWORK_COMMANDS.test(command);
  if (!networkCommand && urls.length === 0) return ok(undefined);
  if (!permissions.network.allowed) return networkDenied("Network access is denied");
  if (urls.length === 0)
    return networkDenied("Network command has no verifiable allowlisted destination");
  const domains = permissions.network.domains.map((domain) => domain.toLowerCase());
  if (
    urls.some(
      (host) =>
        host === undefined ||
        !domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    )
  )
    return networkDenied("Network destination is not allowlisted");
  return ok(undefined);
}

function networkDenied(message: string): Result<void> {
  return err(new ChronosError({ code: ChronosErrorCode.PERMISSION_DENIED, message }));
}
