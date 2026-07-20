import { accessSync, constants } from "node:fs";
import { basename, delimiter, join } from "node:path";

export interface InvocationConfig {
  model: string;
  tools: readonly string[];
  guardExtension: string;
}

export interface PiInvocation {
  executable: string;
  args: string[];
}

export function findPiExecutable(
  env: NodeJS.ProcessEnv = process.env,
  argv = process.argv,
): string | undefined {
  const running = argv[1];
  if (running && basenameIsPi(running)) {
    try {
      accessSync(running, constants.X_OK);
      return running;
    } catch {
      /* continue */
    }
  }
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, process.platform === "win32" ? "pi.exe" : "pi");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* continue */
    }
  }
  return undefined;
}

export function buildPiInvocation(config: InvocationConfig): PiInvocation {
  return {
    executable: findPiExecutable() ?? "pi",
    args: [
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--model",
      config.model,
      "--tools",
      config.tools.join(","),
      "--no-extensions",
      "--extension",
      config.guardExtension,
    ],
  };
}

function basenameIsPi(path: string): boolean {
  const base = basename(path).toLowerCase();
  return base === "pi" || base === "pi.js" || base === "pi.mjs" || base === "pi.exe";
}
