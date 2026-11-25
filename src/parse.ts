export type TrustScope = "tap" | "item";

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** Split a Raycast argument like "--cask foo bar" into argv entries. */
export function splitArgs(input: string): string[] {
  return input.split(/\s+/).filter((part) => part.length > 0);
}

/**
 * Find the `brew trust ...` commands Homebrew suggests in its output and return
 * the argv (without the leading "brew") for each one that should be run.
 *
 * Homebrew prints, for example:
 *   Refusing to load formula foo/bar/baz from untrusted tap foo/bar.
 *   Run `brew trust --formula foo/bar/baz` or `brew trust foo/bar` to trust it.
 *   Warning: Skipping foo/bar because it is not trusted. Run `brew trust foo/bar` to trust it.
 */
export function findTrustCommands(output: string, scope: TrustScope): string[][] {
  const found = new Map<string, string[]>();
  const add = (args: string[]) => {
    const key = args.join(" ");
    if (!found.has(key)) found.set(key, args);
  };

  const lines = stripAnsi(output).split("\n");
  for (const line of lines) {
    const candidates = [...line.matchAll(/`brew trust ([^`]+)`/g)].map((match) => ["trust", ...splitArgs(match[1])]);

    if (candidates.length > 0) {
      const isItem = (args: string[]) => args.some((arg) => arg.startsWith("--"));
      const preferred = candidates.find((args) => (scope === "item" ? isItem(args) : !isItem(args))) ?? candidates[0];
      add(preferred);
    }
  }

  if (found.size === 0) {
    // Fallback for messages without a suggested command.
    for (const line of lines) {
      const tapMatch = line.match(/from untrusted tap ([\w.-]+\/[\w.-]+)/);
      if (tapMatch) add(["trust", tapMatch[1].replace(/\.+$/, "")]);
    }
  }

  return [...found.values()];
}

/** Whether the output says Homebrew skipped something because it is untrusted. */
export function hasUntrustedSkip(output: string): boolean {
  return /because it is not trusted/.test(stripAnsi(output));
}

/**
 * Pick the part of a failed command's output that is worth sharing:
 * everything from the first "Error:" line onward (with any directly preceding
 * warnings), or the tail of the output when no explicit error line exists.
 */
export function extractErrorText(output: string, maxLines = 80): string {
  const lines = stripAnsi(output).replace(/\s+$/, "").split("\n");
  const errorIndex = lines.findIndex((line) => /^(Error|fatal|sudo):/i.test(line.trim()));

  let start = errorIndex >= 0 ? errorIndex : Math.max(0, lines.length - maxLines);
  if (errorIndex >= 0) {
    // Include contiguous warning blocks right before the error.
    while (start > 0 && /^(Warning:|\s)/.test(lines[start - 1]) && lines[start - 1].trim() !== "") {
      start--;
    }
  }

  const excerpt = lines.slice(start);
  return (excerpt.length > maxLines * 2 ? excerpt.slice(-maxLines * 2) : excerpt).join("\n");
}

/** Parse `brew search` output into package names, skipping headers and diagnostics. */
export function parseSearchOutput(output: string): string[] {
  const names: string[] = [];
  for (const raw of stripAnsi(output).split("\n")) {
    // Drop the installed checkmark Homebrew appends on a TTY.
    const line = raw.replace(/\s*✔\s*$/, "").trim();
    if (!line || line.startsWith("==>") || /^(Warning|Error|If you meant|No formulae|No casks)/i.test(line)) continue;
    if (/\s/.test(line)) continue;
    names.push(line);
  }
  return [...new Set(names)];
}

export interface VersionEntry {
  name: string;
  versions: string[];
}

/** Parse `brew list --versions` output ("name 1.0 1.1"). */
export function parseVersionsOutput(output: string): VersionEntry[] {
  return stripAnsi(output)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(Warning|Error):/.test(line))
    .map((line) => {
      const [name, ...versions] = line.split(/\s+/);
      return { name, versions };
    });
}

/**
 * Failures of `brew uninstall` that `--force` gets past, e.g.
 *   Error: Cask 'foo' is not installed.                       (app already deleted by hand)
 *   Error: It seems the App source '/Applications/Foo.app' is not there.
 *   Error: uninstall script /path/uninstall.sh does not exist.
 */
const FORCE_FIXABLE_PATTERNS = [
  /Cask '[^']+' is not installed/,
  /It seems the .+ source '.+' is not there/,
  /uninstall script .+ does not exist/,
  /brew uninstall --force/,
];

export function needsForceRetry(output: string): boolean {
  const text = stripAnsi(output);
  return FORCE_FIXABLE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Insert `--force` right after the subcommand unless it is already present. */
export function withForce(args: string[]): string[] {
  if (args.includes("--force") || args.includes("-f")) return args;
  return [args[0], "--force", ...args.slice(1)];
}

/** Homebrew's own sandbox could not be applied (seen intermittently when launched from Raycast). */
export function isSandboxFailure(output: string): boolean {
  return /sandbox_apply: Operation not permitted/.test(stripAnsi(output));
}

/** Quote argv for a POSIX shell script. */
export function shellQuote(args: string[]): string {
  return args.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/** Homebrew could not touch files under ~/Library because the launching app lacks Full Disk Access. */
export function needsFullDiskAccess(output: string): boolean {
  return /enable Full Disk Access/i.test(stripAnsi(output));
}
