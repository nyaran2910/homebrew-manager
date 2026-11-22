import { Clipboard, showHUD, showToast, Toast } from "@raycast/api";
import { errorClipboardText, loadLastError } from "./brew";

export default async function Command() {
  const entry = await loadLastError();
  if (!entry) {
    await showToast({ style: Toast.Style.Failure, title: "No brew error recorded yet" });
    return;
  }
  await Clipboard.copy(errorClipboardText(entry));
  const firstLine = entry.error.split("\n").find((line) => line.trim()) ?? entry.command;
  await showHUD(`Copied brew error: ${firstLine.slice(0, 80)}`);
}
