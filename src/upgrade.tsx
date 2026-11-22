import { LaunchProps } from "@raycast/api";
import { InstalledList } from "./installed-list";
import { splitArgs } from "./parse";
import { RunView } from "./run-view";

export default function Command(props: LaunchProps<{ arguments: { packages?: string } }>) {
  const args = splitArgs(props.arguments.packages ?? "");
  if (args.length > 0) return <RunView args={["upgrade", ...args]} />;
  return <InstalledList mode="upgrade" />;
}
