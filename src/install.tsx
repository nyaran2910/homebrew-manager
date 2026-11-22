import { Action, ActionPanel, Icon, LaunchProps, List, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { InfoView } from "./info-view";
import { kindArgs, loadInstalled, SearchResult, searchPackages } from "./packages";
import { splitArgs } from "./parse";
import { RunView } from "./run-view";

export default function Command(props: LaunchProps<{ arguments: { packages?: string } }>) {
  const args = splitArgs(props.arguments.packages ?? "");
  if (args.length > 0) return <RunView args={["install", ...args]} />;
  return <SearchList />;
}

function SearchList() {
  const { push } = useNavigation();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  const { data, isLoading } = usePromise(
    async (q: string) => (q.length < 2 ? { results: [], warnings: [] } : searchPackages(q)),
    [trimmed],
  );
  const { data: installed = [], revalidate } = usePromise(loadInstalled, [false]);
  const installedKeys = new Set(installed.map((p) => `${p.kind}:${p.name}`));

  const install = (installArgs: string[]) => push(<RunView args={installArgs} onDone={() => revalidate()} />);

  const resultItem = (result: SearchResult) => {
    const isInstalled = installedKeys.has(`${result.kind}:${result.name.split("/").pop()}`);
    const installArgs = ["install", ...kindArgs(result.kind), result.name];
    const installAction = (
      <Action
        title={isInstalled ? "Reinstall" : "Install"}
        icon={Icon.Download}
        onAction={() => install(isInstalled ? ["reinstall", ...kindArgs(result.kind), result.name] : installArgs)}
      />
    );
    return (
      <List.Item
        key={`${result.kind}:${result.name}`}
        title={result.name}
        icon={result.kind === "cask" ? Icon.AppWindow : Icon.Terminal}
        accessories={[
          ...(isInstalled ? [{ icon: Icon.CheckCircle, tooltip: "Installed" }] : []),
          { text: result.kind },
        ]}
        actions={
          <ActionPanel>
            {installAction}
            <Action.Push
              title="Show Info"
              icon={Icon.Info}
              shortcut={{ modifiers: ["cmd"], key: "i" }}
              target={<InfoView name={result.name} kind={result.kind} actions={installAction} />}
            />
            <Action.CopyToClipboard
              title="Copy Install Command"
              content={`brew ${installArgs.join(" ")}`}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            />
            <Action.CopyToClipboard
              title="Copy Name"
              content={result.name}
              shortcut={{ modifiers: ["cmd"], key: "." }}
            />
          </ActionPanel>
        }
      />
    );
  };

  const results = data?.results ?? [];
  const formulae = results.filter((r) => r.kind === "formula");
  const casks = results.filter((r) => r.kind === "cask");

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      throttle
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Search formulae and casks (or type user/tap/name)…"
    >
      {trimmed.length > 0 && (
        <List.Section title="Run">
          <List.Item
            title={`brew install ${trimmed}`}
            icon={Icon.Play}
            subtitle="Install exactly what you typed"
            actions={
              <ActionPanel>
                <Action
                  title="Install"
                  icon={Icon.Download}
                  onAction={() => install(["install", ...splitArgs(trimmed)])}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      {trimmed.length < 2 && <List.EmptyView title="Type to search Homebrew" icon={Icon.MagnifyingGlass} />}
      <List.Section title="Formulae" subtitle={String(formulae.length)}>
        {formulae.map(resultItem)}
      </List.Section>
      <List.Section title="Casks" subtitle={String(casks.length)}>
        {casks.map(resultItem)}
      </List.Section>
      {data?.warnings.length ? (
        <List.Section title="Warnings">
          {data.warnings.map((warning) => (
            <List.Item key={warning} title={warning.replace(/^Warning:\s*/, "")} icon={Icon.Warning} />
          ))}
        </List.Section>
      ) : null}
    </List>
  );
}
