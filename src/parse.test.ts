import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractErrorText,
  findTrustCommands,
  hasUntrustedSkip,
  parseSearchOutput,
  parseVersionsOutput,
  splitArgs,
} from "./parse.ts";

const refuse =
  "Error: Refusing to load formula foo/bar/baz from untrusted tap foo/bar.\n" +
  "Run `brew trust --formula foo/bar/baz` or `brew trust foo/bar` to trust it.\n";

describe("findTrustCommands", () => {
  it("prefers the whole tap by default", () => {
    assert.deepEqual(findTrustCommands(refuse, "tap"), [["trust", "foo/bar"]]);
  });

  it("prefers the specific item when asked", () => {
    assert.deepEqual(findTrustCommands(refuse, "item"), [["trust", "--formula", "foo/bar/baz"]]);
  });

  it("handles skip warnings and dedupes", () => {
    const output =
      "Warning: Skipping foo/bar because it is not trusted. Run `brew trust foo/bar` to trust it.\n" +
      "Warning: Skipping foo/bar because it is not trusted. Run `brew trust foo/bar` to trust it.\n" +
      "Warning: Skipping a/b because it is not trusted. Run `brew trust a/b` to trust it.\n";
    assert.deepEqual(findTrustCommands(output, "item"), [
      ["trust", "foo/bar"],
      ["trust", "a/b"],
    ]);
    assert.equal(hasUntrustedSkip(output), true);
  });

  it("falls back to the tap name without a suggested command", () => {
    assert.deepEqual(findTrustCommands("Error: cask x from untrusted tap my-org/tools.\n", "tap"), [
      ["trust", "my-org/tools"],
    ]);
  });

  it("returns nothing for unrelated output", () => {
    assert.deepEqual(findTrustCommands("==> Pouring wget\n🍺 done", "tap"), []);
    assert.equal(hasUntrustedSkip("all good"), false);
  });
});

describe("extractErrorText", () => {
  it("starts at the first error line, keeping preceding warnings", () => {
    const output = "==> Fetching x\n==> Downloading\nWarning: something odd\nError: boom\n  details\n";
    assert.equal(extractErrorText(output), "Warning: something odd\nError: boom\n  details");
  });

  it("uses the tail when there is no error line", () => {
    const output = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    assert.equal(extractErrorText(output, 3), "line 7\nline 8\nline 9");
  });

  it("strips ANSI codes", () => {
    assert.equal(extractErrorText("\x1b[31mError:\x1b[0m bad"), "Error: bad");
  });
});

describe("parsers", () => {
  it("splits arguments", () => {
    assert.deepEqual(splitArgs("  --cask  foo bar "), ["--cask", "foo", "bar"]);
  });

  it("parses search output", () => {
    const output = '==> Formulae\nwget\nwget2\n\n==> Casks\nfoo ✔\nIf you meant "x" precisely:\n';
    assert.deepEqual(parseSearchOutput(output), ["wget", "wget2", "foo"]);
  });

  it("parses list --versions output", () => {
    assert.deepEqual(parseVersionsOutput("git 2.47.0\nopenssl@3 3.4.0 3.4.1\n"), [
      { name: "git", versions: ["2.47.0"] },
      { name: "openssl@3", versions: ["3.4.0", "3.4.1"] },
    ]);
  });
});
