import { Action, ActionPanel, Color, Icon, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { execBrew, formatCommand, saveLastError } from "./brew";

interface TrustData {
  taps: string[];
  formulae: string[];
  casks: string[];
  commands: string[];
}

type ItemType = "formula" | "cask" | "command";

async function loadTrustState() {
  const [tapResult, trustResult] = await Promise.all([execBrew(["tap"]), execBrew(["trust", "--json=v1"])]);
  const taps = tapResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes(" "));
  let trust: TrustData = { taps: [], formulae: [], casks: [], commands: [] };
  try {
    trust = { ...trust, ...(JSON.parse(trustResult.stdout) as Partial<TrustData>) };
  } catch {
    // Older Homebrew without `brew trust`: everything is implicitly trusted.
  }
  return { taps, trust };
}

const isOfficial = (tap: string) => tap.toLowerCase().startsWith("homebrew/");

export default function Command() {
  const [query, setQuery] = useState("");
  const { data, isLoading, revalidate } = usePromise(loadTrustState);
  const trustedTaps = new Set(data?.trust.taps.map((t) => t.toLowerCase()) ?? []);

  const run = async (args: string[]) => {
    const command = formatCommand(args);
    const toast = await showToast({ style: Toast.Style.Animated, title: command });
    const { code, stdout, stderr } = await execBrew(args);
    if (code === 0) {
      toast.style = Toast.Style.Success;
      toast.title = `Done: ${command}`;
    } else {
      await saveLastError(args, stdout + stderr);
      toast.style = Toast.Style.Failure;
      toast.title = `Failed: ${command}`;
      toast.message = (stderr || stdout).trim().split("\n")[0];
    }
    revalidate();
  };

  const partialItems = (tap: string) => {
    const prefix = `${tap.toLowerCase()}/`;
    return [...(data?.trust.formulae ?? []), ...(data?.trust.casks ?? []), ...(data?.trust.commands ?? [])].filter(
      (entry) => entry.toLowerCase().startsWith(prefix),
    ).length;
  };

  const typed = query.trim();
  const typedLooksLikeTap = /^[\w.-]+\/[\w.-]+$/.test(typed);
  const items: { type: ItemType; name: string }[] = [
    ...(data?.trust.formulae ?? []).map((name) => ({ type: "formula" as const, name })),
    ...(data?.trust.casks ?? []).map((name) => ({ type: "cask" as const, name })),
    ...(data?.trust.commands ?? []).map((name) => ({ type: "command" as const, name })),
  ];

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Filter taps or type user/repo to trust…"
    >
      {typedLooksLikeTap && !data?.taps.includes(typed) && (
        <List.Section title="Trust">
          <List.Item
            title={`brew trust ${typed}`}
            icon={Icon.Shield}
            actions={
              <ActionPanel>
                <Action title="Trust Tap" icon={Icon.Shield} onAction={() => run(["trust", typed])} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      <List.Section title="Taps">
        {(data?.taps ?? []).map((tap) => {
          const official = isOfficial(tap);
          const trusted = official || trustedTaps.has(tap.toLowerCase());
          const partial = !trusted ? partialItems(tap) : 0;
          const tag = official
            ? { value: "Official", color: Color.SecondaryText }
            : trusted
              ? { value: "Trusted", color: Color.Green }
              : partial > 0
                ? { value: `${partial} item(s) trusted`, color: Color.Yellow }
                : { value: "Untrusted", color: Color.Red };
          return (
            <List.Item
              key={tap}
              title={tap}
              icon={trusted ? Icon.CheckCircle : Icon.Circle}
              accessories={[{ tag }]}
              actions={
                <ActionPanel>
                  {!official && !trusted && (
                    <Action title="Trust Tap" icon={Icon.Shield} onAction={() => run(["trust", tap])} />
                  )}
                  {!official && trusted && (
                    <Action
                      title="Untrust Tap"
                      icon={Icon.XMarkCircle}
                      style={Action.Style.Destructive}
                      onAction={() => run(["untrust", tap])}
                    />
                  )}
                  <Action.OpenInBrowser
                    title="Open on GitHub"
                    url={`https://github.com/${tap.split("/")[0]}/homebrew-${tap.split("/")[1]}`}
                  />
                  <Action.CopyToClipboard title="Copy Tap Name" content={tap} />
                  <Action
                    title="Reload"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={revalidate}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
      {items.length > 0 && (
        <List.Section title="Individually Trusted">
          {items.map(({ type, name }) => (
            <List.Item
              key={`${type}:${name}`}
              title={name}
              icon={Icon.Shield}
              accessories={[{ text: type }]}
              actions={
                <ActionPanel>
                  <Action
                    title={`Untrust ${type}`}
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    onAction={() => run(["untrust", `--${type}`, name])}
                  />
                  <Action.CopyToClipboard title="Copy Name" content={name} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
