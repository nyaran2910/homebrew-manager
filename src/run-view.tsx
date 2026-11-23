import { Action, ActionPanel, Clipboard, Color, Detail, Icon, showToast, Toast } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { errorClipboardText, formatCommand, getPrefs, runBrewWithAutoTrust, saveLastError, StoredError } from "./brew";

type Status = "running" | "success" | "failed";

const MAX_RENDERED_CHARS = 60_000;

export function RunView(props: { args: string[]; title?: string; onDone?: (ok: boolean) => void }) {
  const { args, onDone } = props;
  const command = formatCommand(args);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<Status>("running");
  const [error, setError] = useState<StoredError>();
  const [trusted, setTrusted] = useState<string[]>([]);
  const [forcedCommand, setForcedCommand] = useState<string>();
  const [runId, setRunId] = useState(0);
  const buffer = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    buffer.current = "";
    setOutput("");
    setStatus("running");
    setError(undefined);
    setTrusted([]);
    setForcedCommand(undefined);

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
          signal: controller.signal,
          onTrust: (label) => {
            toast.title = `Trusting: ${label}`;
          },
          onForce: (label) => {
            toast.title = `Retrying with --force: ${label}`;
          },
        },
      );
      if (controller.signal.aborted) return;
      if (flushTimer) clearTimeout(flushTimer);
      setOutput(buffer.current);
      setTrusted(result.trusted);
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
        toast.primaryAction = {
          title: "Copy Error",
          onAction: async (t) => {
            await Clipboard.copy(errorClipboardText(entry));
            t.title = "Error copied";
          },
        };
      }
      onDone?.(result.ok);
    })();

    return () => {
      controller.abort();
      if (flushTimer) clearTimeout(flushTimer);
    };
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
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {error && <Action.CopyToClipboard title="Copy Error" content={errorClipboardText(error)} icon={Icon.Bug} />}
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
