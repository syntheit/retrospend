import { afterEach, describe, expect, it } from "vitest";
import {
	FIELD_MAP,
	JSON_CELLS,
	jsonColumns,
	mappedColumns,
} from "~/server/crypto/fields";
import { USER_TEXT_COLUMNS, userTextColumns } from "./userTextColumns";

const snake = (word: string) =>
	word.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe("the guard tests' column list", () => {
	it("holds every mapped text and JSON column, and its snake_case form", () => {
		for (const [, column] of [...mappedColumns(), ...jsonColumns()]) {
			expect(USER_TEXT_COLUMNS, column).toContain(column);
			expect(USER_TEXT_COLUMNS, column).toContain(snake(column));
		}
		// Columns the old hand copy had lost.
		for (const word of ["fileName", "file_name", "responseBody", "email"])
			expect(USER_TEXT_COLUMNS).toContain(word);
	});

	describe("a column added to the map", () => {
		const maps = FIELD_MAP as unknown as Record<string, unknown>;
		const json = JSON_CELLS as unknown as Record<string, unknown>;
		afterEach(() => {
			delete maps.ZzProbe;
			delete json.ZzJsonProbe;
		});

		it("appears with no edit to the list", () => {
			expect(userTextColumns()).not.toContain("zzProbeColumn");
			maps.ZzProbe = { table: "zz_probe", columns: { zzProbeColumn: "user" } };
			expect(userTextColumns()).toContain("zzProbeColumn");
			expect(userTextColumns()).toContain("zz_probe_column");
		});

		it("appears for a JSON cell as well", () => {
			json.ZzJsonProbe = {
				table: "zz_json",
				columns: { zzJsonBody: { mode: "body", cls: "user" } },
			};
			expect(userTextColumns()).toContain("zzJsonBody");
		});
	});
});
