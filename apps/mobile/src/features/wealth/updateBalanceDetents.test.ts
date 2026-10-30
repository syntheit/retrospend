import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UPDATE_BALANCE_DETENTS } from "./UpdateBalanceSheet";

// Update balance rested at medium and its keypad stopped after 4 5 6, so
// 7 8 9 0 needed a drag up before a balance could be typed. The sheet shows
// the amount, the operator keys, the whole keypad and the footer, which is
// more than half a window holds; it rests at large only.
describe("Update balance detents", () => {
	it("rests at large so the whole keypad and the footer show", () => {
		expect(UPDATE_BALANCE_DETENTS).toEqual(["large"]);
	});

	it("hands those detents to the sheet", () => {
		const source = readFileSync(
			join(__dirname, "UpdateBalanceSheet.tsx"),
			"utf8",
		);
		expect(source).toContain("detents={UPDATE_BALANCE_DETENTS}");
		expect(source).not.toMatch(/detents=\{\[[^\]]*"medium"/);
	});
});
