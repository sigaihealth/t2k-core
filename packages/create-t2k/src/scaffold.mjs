import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profiles = {
  "decision-loop": {
    templateRoot: path.join(packageRoot, "template"),
  },
  "integration-hub": {
    templateRoot: path.join(packageRoot, "template-integration-hub"),
  },
};

export const CREATE_T2K_PROFILES = Object.freeze(Object.keys(profiles));

function requireProfile(value) {
  if (typeof value !== "string" || !Object.hasOwn(profiles, value)) {
    throw new Error(
      `Unsupported profile: ${String(value)}. Choose one of: ${CREATE_T2K_PROFILES.join(
        ", "
      )}.`
    );
  }
  return value;
}

export function parseArguments(argumentsList) {
  const options = {
    targetDirectory: "my-t2k-project",
    install: true,
    help: false,
    version: false,
    profile: "decision-loop",
  };
  const positionals = [];
  let parseOptions = true;
  let profileProvided = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
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
    } else if (parseOptions && argument === "--profile") {
      if (profileProvided) {
        throw new Error("Provide --profile at most once.");
      }
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--profile requires a profile name.");
      }
      options.profile = requireProfile(value);
      profileProvided = true;
      index += 1;
    } else if (parseOptions && argument.startsWith("--profile=")) {
      if (profileProvided) {
        throw new Error("Provide --profile at most once.");
      }
      const value = argument.slice("--profile=".length);
      if (!value) {
        throw new Error("--profile requires a profile name.");
      }
      options.profile = requireProfile(value);
      profileProvided = true;
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
  profile = "decision-loop",
  cwd = process.cwd(),
  stdout = process.stdout,
}) {
  if (typeof targetDirectory !== "string" || !targetDirectory.trim()) {
    throw new Error("Project directory is required.");
  }
  const selectedProfile = requireProfile(profile);
  const targetPath = path.resolve(cwd, targetDirectory);
  const projectName = packageNameFor(targetPath);
  await ensureEmptyDirectory(targetPath);
  await copyTemplate(profiles[selectedProfile].templateRoot, targetPath, {
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
  if (selectedProfile === "integration-hub") {
    stdout.write(
      "The run maps two synthetic sources into a deterministic evidence proposal for human review.\n"
    );
    stdout.write(
      "It does not authenticate either source, mutate source records, or promote a selected value to accepted truth.\n"
    );
  } else {
    stdout.write(
      "The first run computes a recommendation; a human must still authorize it.\n"
    );
    stdout.write(
      "Run `npm run db:up && npm run lifecycle` for the persisted closed loop.\n"
    );
    stdout.write(
      "Use `npm run db:down` to stop it or `npm run db:reset` to delete its volume.\n"
    );
  }

  return { targetPath, projectName, profile: selectedProfile };
}
