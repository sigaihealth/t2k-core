import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(
  packageRoot,
  "../../schemas/t2k-ontology-pack.v1.schema.json"
);
const destination = path.join(
  packageRoot,
  "src/schema/t2k-ontology-pack.v1.schema.json"
);

await fs.mkdir(path.dirname(destination), { recursive: true });
const schema = await fs.readFile(source, "utf8");

let current = "";
try {
  current = await fs.readFile(destination, "utf8");
} catch {
  // The generated package copy does not exist on a fresh checkout.
}

if (current !== schema) {
  await fs.writeFile(destination, schema);
}
