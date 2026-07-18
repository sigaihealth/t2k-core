import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(
  packageRoot,
  "../../schemas/t2k-ontology-pack.v1.schema.json"
);
const destinationDirectory = path.resolve(packageRoot, "dist/schema");

await fs.mkdir(destinationDirectory, { recursive: true });
await fs.copyFile(
  source,
  path.join(destinationDirectory, "t2k-ontology-pack.v1.schema.json")
);
