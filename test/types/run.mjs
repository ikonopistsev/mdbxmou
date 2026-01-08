import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const typesDir = path.join(repoRoot, "test", "types");

const tscBin =
  process.platform === "win32"
    ? path.join(repoRoot, "node_modules", ".bin", "tsc.cmd")
    : path.join(repoRoot, "node_modules", ".bin", "tsc");

if (!fs.existsSync(tscBin)) {
  console.error("Missing TypeScript. Run: npm i");
  process.exit(1);
}

const tmp = path.join(repoRoot, "test", ".tmp-types");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, "node_modules"), { recursive: true });

const linkPath = path.join(tmp, "node_modules", "mdbxmou");
try {
  fs.symlinkSync(repoRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
} catch (e) {
  console.error("Failed to create symlink for test project:", e?.message ?? e);
  process.exit(1);
}

fs.copyFileSync(path.join(typesDir, "tsconfig.json"), path.join(tmp, "tsconfig.json"));
for (const file of ["sync.mts", "async.mts", "cjs.cts"]) {
  fs.copyFileSync(path.join(typesDir, file), path.join(tmp, file));
}

const res = spawnSync(tscBin, ["-p", path.join(tmp, "tsconfig.json")], {
  stdio: "inherit"
});

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(res.status ?? 1);
