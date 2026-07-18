#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArguments, scaffoldProject } from "../src/scaffold.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(
  await fs.readFile(path.join(packageRoot, "package.json"), "utf8")
);

const help = `Create a local T2K governed-decision project.

Usage:
  create-t2k [directory] [options]

Options:
  --no-install   Generate the project without installing dependencies
  --yes          Accept non-interactive defaults
  -h, --help     Show this help
  -v, --version  Show the package version

The default directory is my-t2k-project. Existing non-empty directories are
never overwritten.`;

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${help}\n`);
  } else if (options.version) {
    process.stdout.write(`${packageManifest.version}\n`);
  } else {
    await scaffoldProject({
      targetDirectory: options.targetDirectory,
      install: options.install,
      cwd: process.cwd(),
      stdout: process.stdout,
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`create-t2k: ${message}\n`);
  process.exitCode = 1;
}
