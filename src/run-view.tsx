import { Action, ActionPanel, Clipboard, Color, Detail, Icon, open, showToast, Toast } from "@raycast/api";
import { needsFullDiskAccess } from "./parse";
import { useEffect, useRef, useState } from "react";
import {
  errorClipboardText,
  formatCommand,
  getPrefs,
  runBrewWithAutoTrust,
  runInTerminal,
  saveLastError,
  StoredError,
} from "./brew";

type Status = "running" | "success" | "failed";

const FULL_DISK_ACCESS_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
const openFullDiskAccess = () => open(FULL_DISK_ACCESS_SETTINGS);

const MAX_RENDERED_CHARS = 60_000;

export function RunView(props: { args: string[]; title?: string; onDone?: (ok: boolean) => void }) {
  const { args, onDone } = props;
  const command = formatCommand(args);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<Status>("running");
  const [error, setError] = useState<StoredError>();
  const [trusted, setTrusted] = useState<string[]>([]);
  const [forcedCommand, setForcedCommand] = useState<string>();
  const [lastArgs, setLastArgs] = useState<string[]>();
  const [needsFda, setNeedsFda] = useState(false);
  const [runId, setRunId] = useState(0);
  const buffer = useRef("");
  // React may run effects twice for the same mount (Strict Mode in development builds).
  // Starting brew twice makes two processes stage the same download concurrently and
  // delete each other's files, so start each run exactly once and never abort it from
  // an effect cleanup (killing brew does not stop its worker processes anyway).
  const startedRunId = useRef<number | null>(null);

  useEffect(() => {
    if (startedRunId.current === runId) return;
    startedRunId.current = runId;
    buffer.current = "";
    setOutput("");
    setStatus("running");
    setError(undefined);
    setTrusted([]);
    setForcedCommand(undefined);
    setNeedsFda(false);

    let flushTimer: NodeJS.Timeout | undefined;
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        setOutput(buffer.current);
      }, 150);
    };

    (async () => {
      const toast = await showToast({ style: Toast.Style.Animated, title: `Running ${command}` });
      const result = await runBrewWithAutoTrust(
        args,
        (chunk) => {
          buffer.current += chunk;
          scheduleFlush();
        },
        {
          onTrust: (label) => {
            toast.title = `Trusting: ${label}`;
          },
          onForce: (label) => {
            toast.title = `Retrying with --force: ${label}`;
          },
        },
      );
      if (flushTimer) clearTimeout(flushTimer);
      setOutput(buffer.current);
      setTrusted(result.trusted);
      setLastArgs(result.args);
      if (result.forced) setForcedCommand(formatCommand(result.args));

      if (result.ok) {
        setStatus("success");
        toast.style = Toast.Style.Success;
        toast.title = `Done: ${command}`;
        toast.message =
          [result.forced ? "Used --force" : "", result.trusted.length ? `Trusted ${result.trusted.join(", ")}` : ""]
            .filter(Boolean)
            .join(" · ") || undefined;
      } else {
        setStatus("failed");
        const entry = await saveLastError(result.args, result.output);
        setError(entry);
        toast.style = Toast.Style.Failure;
        toast.title = `Failed: ${command}`;
        toast.message = entry.error.split("\n").find((line) => line.trim()) ?? `exit code ${result.code}`;
        if (getPrefs().copyErrorOnFailure) {
          await Clipboard.copy(errorClipboardText(entry));
          toast.message = `Error copied · ${toast.message}`;
        }
        if (needsFullDiskAccess(result.output)) {
          setNeedsFda(true);
          toast.title = "Raycast needs Full Disk Access";
          toast.message = "Allow it in System Settings, restart Raycast, then run again.";
          toast.primaryAction = { title: "Open Full Disk Access Settings", onAction: openFullDiskAccess };
          toast.secondaryAction = {
            title: "Copy Error",
            onAction: async (t) => {
              await Clipboard.copy(errorClipboardText(entry));
              t.title = "Error copied";
            },
          };
          onDone?.(result.ok);
          return;
        }
        toast.primaryAction = {
          title: "Copy Error",
          onAction: async (t) => {
            await Clipboard.copy(errorClipboardText(entry));
            t.title = "Error copied";
          },
        };
        toast.secondaryAction = {
          title: "Run in Terminal",
          onAction: () => runInTerminal(result.args),
        };
      }
      onDone?.(result.ok);
    })();
  }, [runId]);

  const shown =
    output.length > MAX_RENDERED_CHARS ? "…(truncated)\n" + output.slice(output.length - MAX_RENDERED_CHARS) : output;
  const statusTag =
    status === "running"
      ? { text: "Running", color: Color.Blue }
      : status === "success"
        ? { text: "Succeeded", color: Color.Green }
        : { text: "Failed", color: Color.Red };

  return (
    <Detail
      isLoading={status === "running"}
      navigationTitle={props.title ?? command}
      markdown={"```\n" + (shown || "Starting…") + "\n```"}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Command" text={command} />
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item text={statusTag.text} color={statusTag.color} />
          </Detail.Metadata.TagList>
          {forcedCommand && <Detail.Metadata.Label title="Retried With --force" text={forcedCommand} />}
          {trusted.length > 0 && <Detail.Metadata.Label title="Auto-Trusted" text={trusted.join(", ")} />}
          {error && <Detail.Metadata.Label title="Error" text={error.error.split("\n")[0]} />}
          {needsFda && (
            <Detail.Metadata.Label
              title="Fix"
              text="Allow Raycast in Full Disk Access, restart Raycast, then run again"
            />
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {needsFda && <Action title="Open Full Disk Access Settings" icon={Icon.Lock} onAction={openFullDiskAccess} />}
          {error && <Action.CopyToClipboard title="Copy Error" content={errorClipboardText(error)} icon={Icon.Bug} />}
          {status === "failed" && (
            <Action
              title="Run in Terminal"
              icon={Icon.Terminal}
              shortcut={{ modifiers: ["cmd"], key: "t" }}
              onAction={() => runInTerminal(lastArgs ?? args)}
            />
          )}
          <Action.CopyToClipboard
            title="Copy Full Output"
            content={output}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          {status !== "running" && (
            <Action
              title="Run Again"
              icon={Icon.RotateClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={() => setRunId((id) => id + 1)}
            />
          )}
        </ActionPanel>
      }
    />
  );
}
