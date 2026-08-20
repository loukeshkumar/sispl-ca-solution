import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => existsSync(path) ? readFileSync(path, "utf8") : "";

test("theme system follows the OS and persists an explicit light or dark choice", () => {
  const provider = source("app/theme/theme-provider.tsx");
  const toggle = source("app/theme/theme-toggle.tsx");
  const script = source("app/theme/theme-script.tsx");
  const layout = source("app/layout.tsx");

  assert.match(provider, /"use client"/);
  assert.match(provider, /sispl-theme/);
  assert.match(provider, /matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(provider, /document\.documentElement\.dataset\.theme/);
  assert.match(provider, /localStorage\.setItem/);
  assert.match(provider, /safeReadStoredTheme/);
  assert.match(provider, /safeWriteStoredTheme/);
  assert.match(provider, /catch/);
  assert.match(provider, /addEventListener\("change"/);
  assert.match(provider, /useSyncExternalStore/);
  assert.match(provider, /getServerThemeSnapshot/);
  assert.doesNotMatch(provider, /useState\(currentDocumentTheme\)/);
  assert.match(toggle, /Switch to \$\{theme === "dark" \? "light" : "dark"\} theme/);
  assert.match(toggle, /aria-label=/);
  assert.match(script, /sispl-theme/);
  assert.match(script, /prefers-color-scheme: dark/);
  assert.match(script, /data-theme/);
  assert.match(layout, /<ThemeScript \/>/);
  assert.match(layout, /<ThemeProvider>/);
});
