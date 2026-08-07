import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));
const extensions = new Set([".cpp", ".h", ".hpp"]);

function collectFiles(directory) {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? collectFiles(path) : [path];
        })
        .filter((path) => extensions.has(extname(path)))
        .sort();
}

const check = process.argv.includes("--check");
const requestedFiles = process.argv
    .slice(2)
    .filter((argument) => argument !== "--check");
const files = requestedFiles.length > 0 ? requestedFiles : collectFiles(sourceDirectory);
const arguments_ = check ? ["--dry-run", "--Werror"] : ["-i"];
const result = spawnSync(
    "clang-format",
    ["--style=file", ...arguments_, ...files],
    { stdio: "inherit" },
);

if (result.error) {
    console.error(`Unable to run clang-format: ${result.error.message}`);
    process.exitCode = 1;
} else {
    process.exitCode = result.status ?? 1;
}
