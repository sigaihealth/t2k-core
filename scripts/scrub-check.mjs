import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredNames = new Set([".git", "node_modules", "dist", "coverage"]);
const textExtensions = new Set([
  "",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

const forbidden = [
  { label: "private host alias", pattern: /\bsigdev\d*\b/i },
  { label: "private operator account", pattern: /\byonghuang\b/i },
  { label: "private IPv4 address", pattern: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
  { label: "operator home path", pattern: /\/home\/[a-z0-9._-]+\//i },
  { label: "production environment topology", pattern: /deploy\/\.env\.production/i },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "OpenAI-style secret", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Public source must not contain symlinks: ${path.relative(root, absolute)}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

const findings = [];
for (const file of await filesUnder(root)) {
  const relative = path.relative(root, file);
  if (/\.env(?:\.|$)/i.test(relative) && relative !== ".env.example") {
    findings.push(`${relative}: environment file must not be published`);
    continue;
  }
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const text = await fs.readFile(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) findings.push(`${relative}: ${rule.label}`);
  }
}

if (findings.length > 0) {
  console.error("Public-source scrub failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("Public-source scrub passed: no private topology or credential patterns found.");
}
