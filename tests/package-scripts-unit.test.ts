import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("application scripts use the Next.js runtime only", () => {
  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(packageJson.scripts.lint, "eslint . --ignore-pattern .next");

  for (const removedScript of ["install:ci", "dev:local", "build:local", "start:local", "validate:artifact"]) {
    assert.equal(packageJson.scripts[removedScript], undefined, `${removedScript} must not restore a second runtime path`);
  }
});

test("Cloudflare and Vite tooling is absent from project configuration", async () => {
  for (const dependency of [
    "@cloudflare/vite-plugin",
    "@cloudflare/workers-types",
    "@vitejs/plugin-react",
    "@vitejs/plugin-rsc",
    "cross-env",
    "react-server-dom-webpack",
    "vinext",
    "vite",
    "wrangler",
  ]) {
    assert.equal(packageJson.dependencies?.[dependency], undefined, `${dependency} must not be a runtime dependency`);
    assert.equal(packageJson.devDependencies?.[dependency], undefined, `${dependency} must not be a development dependency`);
  }

  for (const removedPath of ["vite.config.ts", ".openai/hosting.json", "worker/index.ts", "build/sites-vite-plugin.ts"]) {
    await assert.rejects(access(new URL(`../${removedPath}`, import.meta.url)), `${removedPath} must remain removed`);
  }

  const npmConfig = await readFile(new URL("../.npmrc", import.meta.url), "utf8");
  assert.doesNotMatch(npmConfig, /sites-runtime|wrangler|miniflare/i);
});
