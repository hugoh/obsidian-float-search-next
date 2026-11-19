const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("styles.css avoids :has() and !important, which the community scorecard warns about", () => {
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /:has\(/);
  assert.doesNotMatch(css, /!important/);
});

test("LICENSE is the unmodified GPL text so license detection recognises it", () => {
  assert.match(read("LICENSE"), /^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
});

test("manifest minAppVersion covers the Obsidian APIs the plugin imports", () => {
  const { minAppVersion } = JSON.parse(read("manifest.json"));
  const [major, minor, patch] = minAppVersion.split(".").map(Number);
  const atLeast187 = major > 1 || (major === 1 && (minor > 8 || (minor === 8 && patch >= 7)));
  assert.ok(atLeast187, "getLanguage() needs 1.8.7");
});
