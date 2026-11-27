import {
	createOutbox,
	type DeviceBooking,
	type NewOutboxEntry,
} from "./outbox";
import { createMemoryStore } from "./store";

// Account and transfer entries in the outbox: the booked rows keep no name and
// no note, a chained entry takes the account's answered version (a number on
// the row, text on the entry), and the ack keeps it.

const NAME = "SENTINEL-ACCOUNT-NAME-3b2e";
const NOTE = "SENTINEL-TRANSFER-NOTE-3b2e";

const accountRow = (over: Record<string, unknown> = {}) => ({
	id: "a1",
	type: "CASH",
	currency: "USD",
	name: NAME,
	balance: "1000",
	exchangeRate: "1",
	exchangeRateType: "blue",
	closedAt: null,
	createdAt: new Date("2026-10-01T00:00:00.000Z"),
	inBudget: null,
	countedUnits: "0",
	isLiquid: true,
	iconKind: null,
	version: 0,
	...over,
});

const legRow = {
	id: "l1",
	accountId: "a1",
	currency: "USD",
	date: new Date("2026-11-10T03:00:00.000Z"),
	createdAt: new Date("2026-11-10T15:00:00.000Z"),
	amount: "200",
	source: "BALANCE_UPDATE",
	homeAmount: "309000",
	homeCurrency: "ARS",
	countedUnits: "0",
	transferId: null,
	expenseId: null,
};

function accountBooking(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	leg = true,
): DeviceBooking {
	return {
		bookedAt: Date.parse("2026-11-10T15:00:00.000Z"),
		changes: [
			...(leg
				? [
						{
							table: "legs" as const,
							id: "l1",
							before: null,
							after: legRow as never,
						},
					]
				: []),
			{
				table: "accounts" as const,
				id: "a1",
				before: before as never,
				after: after as never,
			},
		],
		changed: [],
	};
}

const entry = (
	clientId: string,
	kind: NewOutboxEntry["kind"],
	base: NewOutboxEntry["baseVersion"],
	device: DeviceBooking,
): NewOutboxEntry => ({
	clientId,
	entity: "accounts",
	kind,
	targetId: "a1",
	baseVersion: base,
	payload: { id: "a1" },
	device,
});

describe("account entries in the outbox", () => {
	it("keep no account name and no transfer note", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(
			entry(
				"u1",
				"balance",
				"0",
				accountBooking(accountRow(), accountRow({ balance: "1200" })),
			),
		);
		await outbox.enqueue({
			clientId: "t1",
			entity: "transfers",
			kind: "create",
			targetId: "t1",
			baseVersion: null,
			payload: {},
			device: {
				bookedAt: 0,
				changes: [
					{
						table: "transfers",
						id: "t1",
						before: null,
						after: {
							id: "t1",
							kind: "TRANSFER",
							note: NOTE,
						} as never,
					},
				],
				changed: [],
			},
		});
		for (const key of await store.keys("outbox:a:"))
			expect(await store.get(key)).not.toMatch(
				/SENTINEL-ACCOUNT-NAME|SENTINEL-TRANSFER-NOTE/,
			);
		const [first, second] = await outbox.all();
		expect(
			first?.device?.changes.find((c) => c.table === "accounts")?.after,
		).not.toHaveProperty("name");
		expect(second?.device?.changes[0]?.after).not.toHaveProperty("note");
	});

	it("stamps a chained entry with the account's answered version, a number on its row", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			entry(
				"u1",
				"balance",
				"0",
				accountBooking(
					accountRow(),
					accountRow({ balance: "1200", version: 1 }),
				),
			),
		);
		await outbox.enqueue(
			entry(
				"u2",
				"close",
				{ after: "u1" },
				accountBooking(
					accountRow({ balance: "1200", version: 1 }),
					accountRow({ balance: "1200", version: 2 }),
					false,
				),
			),
		);
		// The server's answer is 3: the device counted 1 and 2, and takes neither.
		await outbox.markSent("u1", { version: "3", pull: 1 });
		const [second] = await outbox.all();
		expect(second?.baseVersion).toBe("3");
		const account = second?.device?.changes.find((c) => c.table === "accounts");
		expect(account?.before).toMatchObject({ version: 3 });
		expect(account?.after).toMatchObject({ version: 2 });
		const [acked] = await outbox.acked();
		expect(acked?.ack.version).toBe("3");
	});

	it("leaves a leg's row alone when it stamps the account", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			entry("u1", "balance", "0", accountBooking(accountRow(), accountRow())),
		);
		await outbox.enqueue({
			...entry(
				"u2",
				"balance",
				{ after: "u1" },
				{
					bookedAt: 0,
					changes: [
						{ table: "legs", id: "l1", before: legRow as never, after: null },
					],
					changed: [],
				},
			),
		});
		await outbox.markSent("u1", { version: "3", pull: 1 });
		const [second] = await outbox.all();
		expect(second?.device?.changes[0]?.before).toEqual(legRow);
	});
});
