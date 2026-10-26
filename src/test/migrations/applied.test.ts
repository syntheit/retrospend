// Prod stores a checksum for every applied migration, so their files must not
// change, not even a comment (the em dash sweep once edited one). After a prod
// release, add the folders it applied to applied.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../uiRules/paths";
import applied from "./applied.json";

describe("applied migrations", () => {
	it("keep the bytes prod applied", () => {
		const changed = Object.entries(applied.applied).filter(([folder, hash]) => {
			const file = join(
				REPO_ROOT,
				"prisma/migrations",
				folder,
				"migration.sql",
			);
			const now = createHash("sha256").update(readFileSync(file)).digest("hex");
			return now !== hash;
		});
		expect(changed.map(([folder]) => folder)).toEqual([]);
	});
});
