import { readFileSync } from "node:fs";
import { join } from "node:path";

// Update balance rested at medium and its keypad stopped after 4 5 6, so
// 7 8 9 0 needed a drag up before a balance could be typed. The sheet shows
// the amount, the operator keys, the whole keypad and the footer, which is
// more than half a window holds; it rests at large only. (Read from the
// source: the sheet pulls in the native modules a unit test does not load.)
const source = readFileSync(join(__dirname, "UpdateBalanceSheet.tsx"), "utf8");

describe("Update balance detents", () => {
	it("rests at large so the whole keypad and the footer show", () => {
		expect(source).toMatch(
			/UPDATE_BALANCE_DETENTS:\s*SheetDetent\[\]\s*=\s*\["large"\]/,
		);
	});

	it("hands those detents to the sheet, never medium", () => {
		expect(source).toContain("detents={UPDATE_BALANCE_DETENTS}");
		expect(source).not.toMatch(/detents=\{\[[^\]]*"medium"/);
	});
});
