import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("development server scripts set environment variables cross-platform", () => {
  for (const scriptName of ["dev", "start"]) {
    const script = packageJson.scripts[scriptName];

    assert.match(
      script,
      /^cross-env\s/,
      `${scriptName} must use cross-env so it runs in Windows and POSIX shells`,
    );
  }
});
