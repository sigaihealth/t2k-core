import { execFileSync } from "node:child_process";
import process from "node:process";

const range = process.argv[2];
if (!range) {
  console.error("Usage: node scripts/dco-check.mjs <base>..<head>");
  process.exit(2);
}

const output = execFileSync(
  "git",
  ["log", "--format=%H%x1f%B%x1e", range],
  { encoding: "utf8" }
);
const commits = output
  .split("\x1e")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const separator = entry.indexOf("\x1f");
    return {
      sha: entry.slice(0, separator),
      body: entry.slice(separator + 1),
    };
  });

if (commits.length === 0) {
  console.error(`No commits found in ${range}.`);
  process.exit(1);
}

const signoff = /^Signed-off-by: .+ <[^<>\s@]+@[^<>\s]+>$/im;
const missing = commits.filter((commit) => !signoff.test(commit.body));
if (missing.length > 0) {
  console.error("Every contribution must satisfy the Developer Certificate of Origin.");
  for (const commit of missing) {
    console.error(`- ${commit.sha}: missing a valid Signed-off-by line`);
  }
  process.exit(1);
}

console.log(`DCO sign-off verified for ${commits.length} commit(s).`);
