import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = path.join(packageRoot, "template");

export function parseArguments(argumentsList) {
  const options = {
    targetDirectory: "my-t2k-project",
    install: true,
    help: false,
    version: false,
  };
  const positionals = [];
  let parseOptions = true;

  for (const argument of argumentsList) {
    if (parseOptions && argument === "--") {
      parseOptions = false;
    } else if (parseOptions && ["-h", "--help"].includes(argument)) {
      options.help = true;
    } else if (parseOptions && ["-v", "--version"].includes(argument)) {
      options.version = true;
    } else if (parseOptions && argument === "--no-install") {
      options.install = false;
    } else if (parseOptions && argument === "--yes") {
      // The scaffolder has no interactive choices; this keeps npx usage familiar.
    } else if (parseOptions && argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positionals.push(argument);
    }
  }

  if (positionals.length > 1) {
    throw new Error("Provide at most one project directory.");
  }
  if (positionals[0]) {
    options.targetDirectory = positionals[0];
  }
  return options;
}

function packageNameFor(targetPath) {
  const name = path.basename(targetPath).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(
      "The project directory name must use lowercase letters, numbers, dots, dashes, or underscores."
    );
  }
  return name;
}

async function ensureEmptyDirectory(targetPath) {
  try {
    const stat = await fs.lstat(targetPath);
    if (!stat.isDirectory()) {
      throw new Error(`Target exists and is not a directory: ${targetPath}`);
    }
    const entries = await fs.readdir(targetPath);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${targetPath}`);
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      await fs.mkdir(targetPath, { recursive: true });
      return;
    }
    throw error;
  }
}

async function copyTemplate(sourceDirectory, targetDirectory, replacements) {
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Template symbolic links are not supported: ${entry.name}`);
    }
    const outputName = entry.name.endsWith(".template")
      ? entry.name.slice(0, -".template".length)
      : entry.name;
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, outputName);
    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      await copyTemplate(sourcePath, targetPath, replacements);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported template entry: ${entry.name}`);
    }
    let contents = await fs.readFile(sourcePath, "utf8");
    for (const [token, value] of Object.entries(replacements)) {
      contents = contents.replaceAll(token, value);
    }
    await fs.writeFile(targetPath, contents, "utf8");
  }
}

function run(command, argumentsList, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: options.stdio,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${argumentsList.join(" ")} failed${
              signal ? ` with signal ${signal}` : ` with exit code ${code}`
            }.`
          )
        );
      }
    });
  });
}

function shellDisplay(value) {
  return /^[a-zA-Z0-9_./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function scaffoldProject({
  targetDirectory,
  install = true,
  cwd = process.cwd(),
  stdout = process.stdout,
}) {
  if (typeof targetDirectory !== "string" || !targetDirectory.trim()) {
    throw new Error("Project directory is required.");
  }
  const targetPath = path.resolve(cwd, targetDirectory);
  const projectName = packageNameFor(targetPath);
  await ensureEmptyDirectory(targetPath);
  await copyTemplate(templateRoot, targetPath, {
    "{{PROJECT_NAME}}": projectName,
  });

  if (install) {
    stdout.write("Installing dependencies...\n");
    await run(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], {
      cwd: targetPath,
      stdio: "inherit",
    });
  }

  const relativeTarget = path.relative(cwd, targetPath) || ".";
  const commandTarget = path.isAbsolute(targetDirectory)
    ? targetPath
    : relativeTarget;
  stdout.write(`\nCreated ${projectName} in ${targetPath}\n\n`);
  if (commandTarget !== ".") {
    stdout.write(`  cd ${shellDisplay(commandTarget)}\n`);
  }
  if (!install) {
    stdout.write("  npm install\n");
  }
  stdout.write("  npm start\n\n");
  stdout.write("The first run computes a recommendation; a human must still authorize it.\n");

  return { targetPath, projectName };
}
