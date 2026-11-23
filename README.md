# Homebrew (Raycast Extension)

Install, zap-uninstall (`brew uninstall --zap`), and upgrade Homebrew packages from Raycast — with automatic tap trust.

## Commands

| Command | What it does |
| --- | --- |
| **Brew Install** | Search formulae/casks and install. Pass an argument (e.g. `--cask foo`, `user/tap/name`) to run immediately. |
| **Brew Uninstall (Zap)** | Pick an installed cask and run `brew uninstall --zap`, or pass names as an argument. |
| **Brew Upgrade** | List outdated packages; upgrade one or all. Pass names as an argument to upgrade directly. |
| **Brew Trust Taps** | Show taps with their trust status and run `brew trust` / `brew untrust`. |
| **Copy Last Brew Error** | Copy the error excerpt of the last failed brew command to the clipboard. |

## Auto-trust

Homebrew refuses to load formulae/casks from untrusted third-party taps:

```
Error: Refusing to load cask user/tap/foo from untrusted tap user/tap.
Run `brew trust --cask user/tap/foo` or `brew trust user/tap` to trust it.
```

When this (or a "Skipping … because it is not trusted" warning) appears, the extension runs the suggested
`brew trust` command and retries automatically. Choose in preferences whether to trust the whole tap or only
the specific package, or turn auto-trust off.

## Auto `--force` on uninstall

If `brew uninstall` (including `--zap`) fails with an error that `--force` gets past — for example
`Cask 'foo' is not installed.` or `It seems the App source '…' is not there.` after the app was deleted
by hand — the extension retries once with `--force`. Turn this off in preferences if you prefer.
Dependency errors (`… is required by …`) are **not** forced.

## Sandbox errors

Each command starts brew exactly once per run: running the same install twice concurrently makes both
processes stage the same download and fail with errors like `sandbox_apply: Operation not permitted` or
`chmod: …/.caskroom/…: No such file or directory`. If `sandbox_apply` still fails, the command is retried once,
and **Run in Terminal** (toast action or ⌘T in the output view) runs the same command in Terminal.app.

## Notes

- Output streams live into the command view; keep it open until the command finishes.
- Commands needing `sudo` (some casks) show a macOS password dialog via `SUDO_ASKPASS`.
- On failure, the toast offers **Copy Error**; the error is also saved for **Copy Last Brew Error**.
  Enable *Copy the error to the clipboard automatically on failure* to skip that step.
