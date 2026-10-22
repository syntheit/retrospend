// Regenerates openapi.json from the contract:
//   pnpm exec tsx packages/api-contract/scripts/write-openapi.ts
// src/openapi.test.ts fails while the committed file is stale.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateOpenApiDocument, stableStringify } from "../src/openapi";

const target = join(import.meta.dirname, "..", "openapi.json");
writeFileSync(target, stableStringify(await generateOpenApiDocument()));
console.log(`wrote ${target}`);
