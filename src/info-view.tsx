import { Action, ActionPanel, Detail } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { execBrew } from "./brew";
import { kindArgs, PackageKind } from "./packages";

export function InfoView(props: { name: string; kind?: PackageKind; actions?: React.ReactNode }) {
  const args = ["info", ...(props.kind ? kindArgs(props.kind) : []), props.name];
  const { data, isLoading } = usePromise(async () => {
    const { stdout, stderr } = await execBrew(args);
    return (stdout + (stderr ? `\n${stderr}` : "")).trim();
  });
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={props.name}
      markdown={"```\n" + (data ?? "Loading…") + "\n```"}
      actions={
        <ActionPanel>
          {props.actions}
          <Action.CopyToClipboard title="Copy Info" content={data ?? ""} />
        </ActionPanel>
      }
    />
  );
}
