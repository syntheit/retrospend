import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { expect, test } from "../fixtures/sealed-guard";
import { gotoReady } from "../helpers/navigation";

// Flag on (E2E_DEVICE_ENGINE=1, `--project=device-engine`): each web screen
// that holds a device check opens on Sofía's seeded ledger, the device worker
// pulls and checks the screen's figures against the server's, and the report
// the worker logs for that screen is `checked` with nothing that differs. The
// screens keep showing the server's numbers; this reads only the log line,
// whose format (compareLine) holds ids and counts and never an amount.

test.use({ storageState: personaStorageState(SOFIA.username) });

const SCREENS = [
	["budget", "/budget"],
	["wealth", "/wealth"],
	["recurring", "/activity/recurring"],
	["insights", "/activity/insights"],
	["settings", "/settings"],
] as const;

interface Line {
	screen: string;
	state: "checked" | "skipped";
	skipped: string | null;
	keys: number;
	of: number;
	differs: string[];
	behind: number;
	ratesMoved: number;
	zone: "same" | "differs";
}

const LINE = /: compare (\{.*\})$/;

test.describe("device engine compare", () => {
	test("every web screen is checked against the server with nothing that differs", async ({
		page,
	}) => {
		// Five pages on a dev server that compiles each on its first visit, and a pull for each.
		test.setTimeout(300_000);
		const lines: Line[] = [];
		// A worker's console reaches the page's.
		page.on("console", (message) => {
			const found = LINE.exec(message.text());
			if (found?.[1]) lines.push(JSON.parse(found[1]) as Line);
		});

		for (const [screen, path] of SCREENS) {
			await test.step(screen, async () => {
				await gotoReady(page, path);
				await expect
					.poll(() => lines.some((l) => l.screen === screen), {
						message: `${screen} was never checked`,
						timeout: 60_000,
					})
					.toBe(true);
				const report = lines.filter((l) => l.screen === screen).at(-1) as Line;
				expect(report, JSON.stringify(report)).toMatchObject({
					state: "checked",
					skipped: null,
					differs: [],
					behind: 0,
					ratesMoved: 0,
				});
				expect(report.keys, `${screen} held no figure`).toBeGreaterThan(0);
			});
		}
	});
});
