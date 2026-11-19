import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";

const installed = "node_modules/moment";
const hidden = "node_modules/.moment-hidden";

if (!existsSync(installed)) {
  console.error("node_modules/moment not found; run bun install first");
  process.exit(1);
}

renameSync(installed, hidden);
let status = 1;
try {
  status = spawnSync("bunx", ["eslint", "--max-warnings", "0", "src"], {
    stdio: "inherit",
  }).status ?? 1;
} finally {
  renameSync(hidden, installed);
}
process.exit(status);
