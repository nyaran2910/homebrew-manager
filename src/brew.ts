import { environment, getPreferenceValues, LocalStorage } from "@raycast/api";
import { execFile, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  extractErrorText,
  findTrustCommands,
  hasUntrustedSkip,
  needsForceRetry,
  stripAnsi,
  TrustScope,
  withForce,
} from "./parse";

interface Preferences {
  autoTrust?: boolean;
  trustScope?: TrustScope;
  copyErrorOnFailure?: boolean;
  autoForceUninstall?: boolean;
  brewPath?: string;
}

export function getPrefs() {
  const prefs = getPreferenceValues<Preferences>();
  return {
    autoTrust: prefs.autoTrust ?? true,
    trustScope: prefs.trustScope ?? "tap",
    copyErrorOnFailure: prefs.copyErrorOnFailure ?? false,
    autoForceUninstall: prefs.autoForceUninstall ?? true,
    brewPath: prefs.brewPath?.trim() || undefined,
  };
}

export function brewExecutable(): string {
  const custom = getPrefs().brewPath;
  if (custom) return custom;
  for (const candidate of ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "brew";
}

const ASKPASS_SCRIPT = `#!/bin/sh
exec /usr/bin/osascript \\
  -e 'text returned of (display dialog "Homebrew needs your administrator password (sudo)." default answer "" with hidden answer with title "Homebrew" with icon caution)'
`;

function askpassPath(): string {
  const path = join(environment.supportPath, "sudo-askpass.sh");
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, ASKPASS_SCRIPT);
    chmodSync(path, 0o755);
  } catch {
    // Ignore: sudo will just fail with a readable error instead.
  }
  return path;
}

function brewEnv(): NodeJS.ProcessEnv {
  const brew = brewExecutable();
  const brewBin = brew.includes("/") ? dirname(brew) : "/opt/homebrew/bin";
  return {
    ...process.env,
    PATH: [brewBin, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", process.env.PATH]
      .filter(Boolean)
      .join(":"),
    HOMEBREW_NO_COLOR: "1",
    HOMEBREW_NO_EMOJI: "1",
    HOMEBREW_NO_ENV_HINTS: "1",
    NONINTERACTIVE: "1",
    SUDO_ASKPASS: askpassPath(),
  };
}

export function formatCommand(args: string[]): string {
  return ["brew", ...args].map((arg) => (/[\s"'$`\\]/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
}

/** Run brew quietly and return stdout (for listing / searching). */
export function execBrew(args: string[], timeout = 120_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      brewExecutable(),
      args,
      { env: brewEnv(), timeout, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ stdout: stripAnsi(String(stdout)), stderr: stripAnsi(String(stderr)), code });
      },
    );
  });
}

/** Run brew, streaming combined stdout/stderr to `onOutput`. */
export function spawnBrew(args: string[], onOutput: (chunk: string) => void, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(brewExecutable(), args, { env: brewEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort);
    child.stdout.on("data", (data: Buffer) => onOutput(stripAnsi(data.toString())));
    child.stderr.on("data", (data: Buffer) => onOutput(stripAnsi(data.toString())));
    child.on("error", (error) => {
      onOutput(`\nError: failed to start brew: ${error.message}\n`);
      resolve(127);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(code ?? 1);
    });
  });
}

export interface RunResult {
  ok: boolean;
  code: number;
  output: string;
  trusted: string[];
  /** The final argv that was run (may include an added --force). */
  args: string[];
  forced: boolean;
}

/**
 * Run a brew command. If Homebrew says a tap/package must be trusted, run the
 * suggested `brew trust` command(s) and retry (when auto-trust is enabled).
 * If `brew uninstall` fails with an error that `--force` gets past, retry with
 * `--force` (when auto-force is enabled).
 */
export async function runBrewWithAutoTrust(
  args: string[],
  onOutput: (chunk: string) => void,
  options: {
    signal?: AbortSignal;
    onTrust?: (command: string) => void;
    onForce?: (command: string) => void;
  } = {},
): Promise<RunResult> {
  const { autoTrust, trustScope, autoForceUninstall } = getPrefs();
  let current = args;
  let forced = false;
  const applied = new Set<string>();
  const trusted: string[] = [];
  let fullOutput = "";
  const emit = (chunk: string) => {
    fullOutput += chunk;
    onOutput(chunk);
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    let attemptOutput = "";
    emit(`$ ${formatCommand(current)}\n`);
    const code = await spawnBrew(
      current,
      (chunk) => {
        attemptOutput += chunk;
        emit(chunk);
      },
      options.signal,
    );
    if (options.signal?.aborted) return { ok: false, code, output: fullOutput, trusted, args: current, forced };

    const pending = findTrustCommands(attemptOutput, trustScope).filter((cmd) => !applied.has(cmd.join(" ")));
    const needsTrust = pending.length > 0 && (code !== 0 || hasUntrustedSkip(attemptOutput));

    if (!autoTrust || !needsTrust) {
      const canForce =
        autoForceUninstall && code !== 0 && current[0] === "uninstall" && !forced && needsForceRetry(attemptOutput);
      if (canForce) {
        forced = true;
        current = withForce(current);
        const label = formatCommand(current);
        options.onForce?.(label);
        emit(`\n==> Uninstall failed with an error --force can fix; retrying: ${label}\n`);
        continue;
      }
      return { ok: code === 0, code, output: fullOutput, trusted, args: current, forced };
    }

    let trustFailed = false;
    for (const trustArgs of pending) {
      applied.add(trustArgs.join(" "));
      const label = formatCommand(trustArgs);
      options.onTrust?.(label);
      emit(`\n==> Auto-trust: ${label}\n$ ${label}\n`);
      const trustCode = await spawnBrew(trustArgs, emit, options.signal);
      if (trustCode !== 0) trustFailed = true;
      else trusted.push(trustArgs[trustArgs.length - 1]);
    }
    if (trustFailed) {
      return { ok: false, code: code || 1, output: fullOutput, trusted, args: current, forced };
    }
    emit(`\n==> Retrying after trusting ${pending.length} target(s)\n`);
  }

  return { ok: false, code: 1, output: fullOutput, trusted, args: current, forced };
}

// ---------- Last error storage ----------

const LAST_ERROR_KEY = "last-error";

export interface StoredError {
  command: string;
  error: string;
  output: string;
  at: string;
}

export async function saveLastError(args: string[], output: string): Promise<StoredError> {
  const entry: StoredError = {
    command: formatCommand(args),
    error: extractErrorText(output),
    output: stripAnsi(output),
    at: new Date().toISOString(),
  };
  await LocalStorage.setItem(LAST_ERROR_KEY, JSON.stringify(entry));
  return entry;
}

export async function loadLastError(): Promise<StoredError | undefined> {
  const raw = await LocalStorage.getItem<string>(LAST_ERROR_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as StoredError;
  } catch {
    return undefined;
  }
}

export function errorClipboardText(entry: StoredError): string {
  return `$ ${entry.command}\n${entry.error}`;
}
