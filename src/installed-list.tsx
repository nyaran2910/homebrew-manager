import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo } from "react";
import { InfoView } from "./info-view";
import { InstalledPackage, kindArgs, loadInstalled } from "./packages";
import { RunView } from "./run-view";

export type ListMode = "zap" | "upgrade";

const TITLES: Record<ListMode, string> = {
  zap: "Search installed casks to zap…",
  upgrade: "Search outdated packages…",
};

export function InstalledList(props: { mode: ListMode }) {
  const { mode } = props;
  const { push } = useNavigation();
  const { data = [], isLoading, revalidate } = usePromise(loadInstalled, [mode === "upgrade"]);

  const visible = useMemo(() => {
    if (mode === "zap") return data.filter((p) => p.kind === "cask");
    if (mode === "upgrade") return data.filter((p) => p.outdated);
    return data;
  }, [data, mode]);

  const run = (args: string[]) => push(<RunView args={args} onDone={() => revalidate()} />);

  const uninstall = async (pkg: InstalledPackage, zap: boolean) => {
    const confirmed = await confirmAlert({
      title: zap ? `Zap ${pkg.name}?` : `Uninstall ${pkg.name}?`,
      message: zap
        ? "brew uninstall --zap also removes the app's preferences, caches and support files."
        : `brew uninstall ${kindArgs(pkg.kind).join(" ")} ${pkg.name}`,
      icon: zap ? Icon.Trash : Icon.MinusCircle,
      primaryAction: { title: zap ? "Zap" : "Uninstall", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    run(["uninstall", ...(zap ? ["--zap"] : []), ...kindArgs(pkg.kind), pkg.name]);
  };

  const packageActions = (pkg: InstalledPackage) => {
    const upgrade = (
      <Action
        key="upgrade"
        title="Upgrade"
        icon={Icon.ArrowUpCircle}
        shortcut={{ modifiers: ["cmd"], key: "u" }}
        onAction={() => run(["upgrade", ...kindArgs(pkg.kind), pkg.name])}
      />
    );
    const remove = (
      <Action
        key="uninstall"
        title="Uninstall"
        icon={Icon.MinusCircle}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ["ctrl"], key: "x" }}
        onAction={() => uninstall(pkg, false)}
      />
    );
    const zap =
      pkg.kind === "cask" ? (
        <Action
          key="zap"
          title="Uninstall with --zap"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
          onAction={() => uninstall(pkg, true)}
        />
      ) : null;
    const ordered = mode === "upgrade" ? [upgrade, remove, zap] : [zap, remove, upgrade];
    return (
      <ActionPanel>
        <ActionPanel.Section>{ordered}</ActionPanel.Section>
        <ActionPanel.Section>
          <Action.Push
            title="Show Info"
            icon={Icon.Info}
            shortcut={{ modifiers: ["cmd"], key: "i" }}
            target={<InfoView name={pkg.name} kind={pkg.kind} />}
          />
          <Action.CopyToClipboard title="Copy Name" content={pkg.name} shortcut={{ modifiers: ["cmd"], key: "." }} />
          <Action
            title="Reload"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={revalidate}
          />
        </ActionPanel.Section>
      </ActionPanel>
    );
  };

  const item = (pkg: InstalledPackage) => (
    <List.Item
      key={`${pkg.kind}:${pkg.name}`}
      title={pkg.name}
      icon={pkg.kind === "cask" ? Icon.AppWindow : Icon.Terminal}
      keywords={[pkg.kind]}
      accessories={[
        ...(pkg.outdated
          ? [
              {
                tag: {
                  value: `→ ${pkg.outdated.current}`,
                  color: pkg.outdated.pinned ? Color.SecondaryText : Color.Orange,
                },
              },
            ]
          : []),
        { text: pkg.version },
      ]}
      actions={packageActions(pkg)}
    />
  );

  const formulae = visible.filter((p) => p.kind === "formula");
  const casks = visible.filter((p) => p.kind === "cask");

  return (
    <List isLoading={isLoading} searchBarPlaceholder={TITLES[mode]}>
      {mode === "upgrade" && (
        <List.Section title="All">
          <List.Item
            title="Upgrade All"
            subtitle={isLoading ? "" : `${visible.length} outdated`}
            icon={Icon.ArrowUpCircleFilled}
            actions={
              <ActionPanel>
                <Action title="Upgrade All" icon={Icon.ArrowUpCircle} onAction={() => run(["upgrade"])} />
                <Action title="Update Homebrew (brew update)" icon={Icon.Download} onAction={() => run(["update"])} />
                <Action
                  title="Reload"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={revalidate}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      {!isLoading && visible.length === 0 && mode !== "upgrade" && (
        <List.EmptyView title="No casks installed" icon={Icon.Box} />
      )}
      <List.Section title="Formulae" subtitle={String(formulae.length)}>
        {formulae.map(item)}
      </List.Section>
      <List.Section title="Casks" subtitle={String(casks.length)}>
        {casks.map(item)}
      </List.Section>
    </List>
  );
}
