import { execBrew } from "./brew";
import { parseSearchOutput, parseVersionsOutput } from "./parse";

export type PackageKind = "formula" | "cask";

export interface InstalledPackage {
  name: string;
  kind: PackageKind;
  version: string;
  outdated?: { current: string; pinned: boolean };
}

interface OutdatedJson {
  formulae?: { name: string; installed_versions: string[]; current_version: string; pinned?: boolean }[];
  casks?: { name: string; installed_versions: string[] | string; current_version: string }[];
}

export async function loadOutdated(): Promise<Map<string, { current: string; pinned: boolean }>> {
  const { stdout } = await execBrew(["outdated", "--json=v2"]);
  const map = new Map<string, { current: string; pinned: boolean }>();
  try {
    const data = JSON.parse(stdout) as OutdatedJson;
    for (const f of data.formulae ?? [])
      map.set(`formula:${f.name}`, { current: f.current_version, pinned: !!f.pinned });
    for (const c of data.casks ?? []) map.set(`cask:${c.name}`, { current: c.current_version, pinned: false });
  } catch {
    // brew outdated may print nothing parseable when offline; treat as none.
  }
  return map;
}

export async function loadInstalled(withOutdated: boolean): Promise<InstalledPackage[]> {
  const [formulae, casks, outdated] = await Promise.all([
    execBrew(["list", "--formula", "--versions"]),
    execBrew(["list", "--cask", "--versions"]),
    withOutdated ? loadOutdated() : Promise.resolve(new Map<string, { current: string; pinned: boolean }>()),
  ]);
  const toPackages = (stdout: string, kind: PackageKind): InstalledPackage[] =>
    parseVersionsOutput(stdout).map(({ name, versions }) => ({
      name,
      kind,
      version: versions[versions.length - 1] ?? "",
      outdated: outdated.get(`${kind}:${name}`),
    }));
  return [...toPackages(formulae.stdout, "formula"), ...toPackages(casks.stdout, "cask")].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export interface SearchResult {
  name: string;
  kind: PackageKind;
}

export async function searchPackages(query: string): Promise<{ results: SearchResult[]; warnings: string[] }> {
  const [formulae, casks] = await Promise.all([
    execBrew(["search", "--formula", query], 60_000),
    execBrew(["search", "--cask", query], 60_000),
  ]);
  const warnings = [
    ...new Set(
      [formulae.stderr, casks.stderr]
        .join("\n")
        .split("\n")
        .filter((line) => line.startsWith("Warning:")),
    ),
  ];
  return {
    results: [
      ...parseSearchOutput(formulae.stdout).map((name) => ({ name, kind: "formula" as const })),
      ...parseSearchOutput(casks.stdout).map((name) => ({ name, kind: "cask" as const })),
    ],
    warnings,
  };
}

export function kindArgs(kind: PackageKind): string[] {
  return kind === "cask" ? ["--cask"] : ["--formula"];
}
