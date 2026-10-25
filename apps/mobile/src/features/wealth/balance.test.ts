import { balanceRows, isUnchanged } from "./balance";
import type { BalancePreview } from "./source";

const ars = (minor: number) => ({ minor, currency: "ARS" });

// Recorded from POST /accounts/{id}/balance/preview on a seeded book.
const preview = {
	changes: [
		{
			id: "netWorth",
			currency: "ARS",
			before: ars(1196764895),
			after: ars(1202764895),
			delta: ars(6000000),
			figureAfter: [ars(1202764895)],
		},
		{
			id: "accounts.balance",
			currency: "ARS",
			before: ars(184000000),
			after: ars(190000000),
			delta: ars(6000000),
			figureAfter: [ars(190000000)],
		},
	],
	unchanged: [],
	unavailable: [],
	detail: {
		kind: "account.updateBalance",
		result: {
			accountId: "a1",
			name: "Galicia (ARS)",
			before: ars(184000000),
			after: ars(190000000),
			notLogged: ars(6000000),
			rateSwitch: null,
			legId: "l1",
			previousRate: "1450",
		},
	},
} as unknown as BalancePreview;

describe("update balance preview", () => {
	it("reads the account's own line and the Not logged difference", () => {
		expect(balanceRows(preview)).toEqual({
			balance: { before: ars(184000000), after: ars(190000000) },
			notLogged: ars(6000000),
		});
		expect(isUnchanged(balanceRows(preview))).toBe(false);
	});

	it("an update that changes nothing says so and has no Not logged line", () => {
		const same = {
			...preview,
			changes: [],
			detail: {
				kind: "account.updateBalance",
				result: { before: ars(100), after: ars(100), notLogged: ars(0) },
			},
		} as unknown as BalancePreview;
		const rows = balanceRows(same);
		expect(rows.notLogged).toBeNull();
		expect(isUnchanged(rows)).toBe(true);
	});

	it("survives an answer with no detail", () => {
		const bare = { ...preview, detail: undefined } as unknown as BalancePreview;
		expect(balanceRows(bare).balance).toBeNull();
		expect(isUnchanged(balanceRows(bare))).toBe(false);
	});
});
