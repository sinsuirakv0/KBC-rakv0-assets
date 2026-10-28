import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHARACTER_ALIAS_PATHS, updateCharacterAliases } from "./update-character-aliases.mjs";
import { readDataContext } from "./data.mjs";

const DEFAULT_COMMIT_MESSAGE = "chore(assets): update character aliases";

export async function publishCharacterAliases(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ));
  const message = options.message ?? DEFAULT_COMMIT_MESSAGE;
  if (typeof message !== "string" || message.trim() === "") {
    throw new Error("Commit message must not be empty.");
  }

  const actualRoot = (await runGit(repoRoot, ["rev-parse", "--show-toplevel"])).stdout.trim();
  if (path.resolve(actualRoot) !== repoRoot) throw new Error(`Unexpected Git root: ${actualRoot}`);
  await runGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const {current} = await readDataContext(repoRoot);
  await runGit(repoRoot,["cat-file","-e",`HEAD:jp/Local/${current.versionCode}`]);
  await runGit(repoRoot,["diff","--quiet","HEAD","--",`jp/Local/${current.versionCode}`,"jp/server","overrides/jp/assets","overrides/jp/characters/data.json"]);

  const staged = splitNull((await runGit(repoRoot, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
  ])).stdout);
  const unexpected = staged.filter(file => !CHARACTER_ALIAS_PATHS.some(prefix => toPosix(file) === prefix || toPosix(file).startsWith(prefix + "/")));
  if (unexpected.length > 0) {
    throw new Error("Unrelated staged changes exist. Commit or unstage them before publishing aliases.");
  }

  await updateCharacterAliases({ repoRoot });
  await runGit(repoRoot, ["add", "--", ...CHARACTER_ALIAS_PATHS], { inherit: true });
  const diff = await runGit(repoRoot, ["diff", "--cached", "--quiet", "--", ...CHARACTER_ALIAS_PATHS], {
    acceptedExitCodes: [0, 1],
  });
  if (diff.exitCode === 0) {
    process.stdout.write("Character aliases are already up to date. Nothing was committed or pushed.\n");
    return { published: false };
  }

  await runGit(repoRoot, ["commit", "-m", message], { inherit: true });
  await runGit(repoRoot, ["push"], { inherit: true });
  return { published: true };
}

function runGit(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", chunk => { stdout += chunk; });
    if (child.stderr) child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", exitCode => {
      const accepted = options.acceptedExitCodes ?? [0];
      if (accepted.includes(exitCode)) resolve({ exitCode, stdout, stderr });
      else reject(new Error(`git ${args[0]} failed (${exitCode}): ${stderr.trim()}`));
    });
  });
}

function splitNull(value) {
  return value.split("\0").filter(Boolean);
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--message") options.message = requireValue(argv, ++index, argument);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  publishCharacterAliases(parseArguments(process.argv.slice(2))).catch(error => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
