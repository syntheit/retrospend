import {
	ACCOUNT_TEXT_COLUMNS,
	EXPENSE_TEXT_COLUMNS,
	TEMPLATE_STRIPPED_COLUMNS,
	TRANSFER_TEXT_COLUMNS,
} from "@retrospend/engine";
import { ACKED_MAX, ACKED_MAX_AGE_MS, createOutbox } from "./outbox";
import { DEVICE_TEXT_COLUMNS } from "./outbox-chain";
import {
	bookedRow,
	booking,
	confirm,
	confirmBooking,
	create,
	edit,
	SENTINEL,
	TEMPLATE_SENTINEL,
	templateEdit,
	templateRow,
} from "./outboxFixtures";
import { createMemoryStore } from "./store";
import { flushOutbox } from "./sync";

const T1 = "2026-10-15T15:00:01.000Z";
const T2 = "2026-10-15T15:00:02.000Z";

const device = (id: string) => booking(id, null, bookedRow(id));

describe("sealed request", () => {
	it("is kept in its entry across a restart, and the entry keeps nothing else of it", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(create("e1"));
		await outbox.enqueue(create("e2"));
		await outbox.seal("e1", "ab12cd");
		const restarted = createOutbox(store, "a");
		const [first, second] = await restarted.all();
		expect(first?.sealed).toBe("ab12cd");
		expect(second?.sealed).toBeUndefined();
	});
});

describe("an acked write", () => {
	it("keeps no sealed request: the server answered, so it has no use", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("e1", device("e1")));
		await outbox.seal("e1", "ab12cd");
		await outbox.markSent("e1", { version: T1, pull: 1 });
		const [acked] = await outbox.acked();
		expect(acked?.clientId).toBe("e1");
		expect(acked?.sealed).toBeUndefined();
	});
});

describe("device field", () => {
	it("holds no title, description or location", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(
			create(
				"e1",
				booking("e1", bookedRow("e1", {}, true), bookedRow("e1", {}, true)),
			),
		);
		for (const key of await store.keys("")) {
			const raw = (await store.get(key)) ?? "";
			for (const text of Object.values(SENTINEL))
				expect(raw).not.toContain(text);
		}
		const row = (await outbox.all())[0]?.device?.changes[0]?.after;
		for (const column of DEVICE_TEXT_COLUMNS.expenses)
			expect(row).not.toHaveProperty(column);
	});

	it("template rows hold no name, websiteUrl or paymentSource", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(
			edit(
				"t1",
				"t1",
				null,
				booking(
					"t1",
					templateRow("t1", {}, true),
					templateRow("t1", { autoPay: false }, true),
					{},
					"recurringTemplates",
				),
			),
		);
		const texts = [
			TEMPLATE_SENTINEL.name,
			TEMPLATE_SENTINEL.websiteUrl,
			TEMPLATE_SENTINEL.paymentSource,
			TEMPLATE_SENTINEL.category.name,
		];
		for (const key of await store.keys("")) {
			const raw = (await store.get(key)) ?? "";
			for (const text of texts) expect(raw).not.toContain(text);
		}
		const change = (await outbox.all())[0]?.device?.changes[0];
		expect(change?.table).toBe("recurringTemplates");
		for (const side of [change?.before, change?.after]) {
			for (const column of DEVICE_TEXT_COLUMNS.recurringTemplates)
				expect(side).not.toHaveProperty(column);
			expect(side).toMatchObject({ id: "t1", amountMode: "FIXED" });
		}
	});

	it("stamps a chained template edit with the version its predecessor was acked at", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const t = (
			before: Record<string, unknown>,
			after: Record<string, unknown>,
		) => booking("t1", before, after, {}, "recurringTemplates");
		await outbox.enqueue(
			templateEdit(
				"u1",
				"t1",
				"v0",
				t(templateRow("t1"), templateRow("t1", { autoPay: false })),
			),
		);
		await outbox.enqueue(
			templateEdit(
				"u2",
				"t1",
				{ after: "u1" },
				t(
					templateRow("t1", { autoPay: false }),
					templateRow("t1", { isActive: false }),
				),
			),
		);
		await outbox.markSent("u1", { version: T1, pull: 1 });
		const [second] = await outbox.all();
		expect(second?.baseVersion).toBe(T1);
		expect(second?.device?.changes[0]?.before).toMatchObject({ version: T1 });
	});

	it("names the same text columns as the engine, table by table", () => {
		expect([...DEVICE_TEXT_COLUMNS.expenses]).toEqual([
			...EXPENSE_TEXT_COLUMNS,
		]);
		expect([...DEVICE_TEXT_COLUMNS.recurringTemplates]).toEqual([
			...TEMPLATE_STRIPPED_COLUMNS,
		]);
		expect([...DEVICE_TEXT_COLUMNS.accounts]).toEqual([
			...ACCOUNT_TEXT_COLUMNS,
		]);
		expect([...DEVICE_TEXT_COLUMNS.transfers]).toEqual([
			...TRANSFER_TEXT_COLUMNS,
		]);
		// Legs, snapshots and rate switches hold no person's text.
		expect(DEVICE_TEXT_COLUMNS.legs).toEqual([]);
		expect(DEVICE_TEXT_COLUMNS.snapshots).toEqual([]);
		expect(DEVICE_TEXT_COLUMNS.rateSwitches).toEqual([]);
	});

	it("reads rows back with real dates and the booked decimal text", async () => {
		const store = createMemoryStore();
		await createOutbox(store, "a").enqueue(create("e1", device("e1")));
		const change = (await createOutbox(store, "a").all())[0]?.device
			?.changes[0];
		expect(change?.after).toMatchObject({
			date: new Date("2026-10-05T03:00:00.000Z"),
			amount: "100.00",
		});
	});
});

describe("acked list", () => {
	it("acked entry survives a restart, with its rows and version, and not in the waiting count", async () => {
		const store = createMemoryStore();
		const first = createOutbox(store, "a");
		await first.enqueue(create("e1", device("e1")));
		await first.markSent("e1", { version: T1, pull: 3 });
		expect((await first.acked())[0]?.ack).toEqual({ version: T1, pull: 3 });

		const restarted = createOutbox(store, "a");
		const [entry] = await restarted.acked();
		expect(entry).toMatchObject({ clientId: "e1", ack: { version: T1 } });
		expect(entry?.device?.changes[0]?.after?.id).toBe("e1");
		// The engine's pull count restarts with the run.
		expect(entry?.ack.pull).toBe(0);
		expect(await restarted.all()).toEqual([]);
	});

	it("keeps the expense version a recurring confirm's answer named, next to the template's", async () => {
		const store = createMemoryStore();
		const first = createOutbox(store, "a");
		await first.enqueue(create("e1", device("e1")));
		await first.markSent("e1", { version: T1, expenseVersion: T2, pull: 1 });
		const [entry] = await createOutbox(store, "a").acked();
		expect(entry?.ack).toEqual({ version: T1, expenseVersion: T2, pull: 0 });
	});

	it("deletes an entry without a device booking at its ack", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("e1"));
		await outbox.markSent("e1", { version: T1 });
		expect(await outbox.acked()).toEqual([]);
	});

	it("does not keep an unbooked entry, which has no rows to compare", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			create("e1", {
				bookedAt: 0,
				changes: [],
				changed: [],
				unbooked: "no_rate",
			}),
		);
		await outbox.markSent("e1", { version: T1 });
		expect(await outbox.acked()).toEqual([]);
	});

	it("keeps the order of both lists in one sequence", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("e1", device("e1")));
		await outbox.enqueue(create("e2", device("e2")));
		await outbox.markSent("e2", { version: T1 });
		const { open, acked } = await outbox.snapshot();
		expect(open[0]?.seq).toBeLessThan(acked[0]?.seq ?? 0);
	});

	it("retires, and reports an undone entry once", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		for (const id of ["e1", "e2"]) {
			await outbox.enqueue(create(id, device(id)));
			await outbox.markSent(id, { version: T1 });
		}
		await outbox.retire(["e1"]);
		await outbox.undone("e2");
		expect(await outbox.acked()).toEqual([]);
		expect(outbox.takeLeft().map((l) => [l.entry.clientId, l.code])).toEqual([
			["e2", "undone"],
		]);
		expect(outbox.takeLeft()).toEqual([]);
	});

	it("drops an entry older than 7 days as expired", async () => {
		let clock = new Date("2026-10-01T00:00:00.000Z");
		const outbox = createOutbox(createMemoryStore(), "a", () => clock);
		await outbox.enqueue(create("e1", device("e1")));
		await outbox.markSent("e1", { version: T1 });
		clock = new Date(clock.getTime() + ACKED_MAX_AGE_MS - 1);
		expect(await outbox.acked()).toHaveLength(1);
		clock = new Date(clock.getTime() + 2);
		expect(await outbox.acked()).toEqual([]);
		expect(outbox.takeLeft().map((l) => l.code)).toEqual(["expired"]);
	});

	it("keeps the newest 200 and expires the older", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		for (let i = 0; i <= ACKED_MAX; i++) {
			await outbox.enqueue(create(`e${i}`, device(`e${i}`)));
			await outbox.markSent(`e${i}`, { version: T1 });
		}
		const kept = await outbox.acked();
		expect(kept).toHaveLength(ACKED_MAX);
		expect(kept[0]?.clientId).toBe("e1");
		expect(outbox.takeLeft().map((l) => l.entry.clientId)).toEqual(["e0"]);
	});

	it("clear drops both lists and the undo generations", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(create("e1", device("e1")));
		await outbox.markSent("e1", { version: T1 });
		await outbox.enqueue(create("e2", device("e2")));
		await outbox.nextUndoGeneration("e1");
		await outbox.clear();
		expect(await store.keys("")).toEqual([]);
	});

	it("keeps accounts apart", async () => {
		const store = createMemoryStore();
		const a = createOutbox(store, "a");
		await a.enqueue(create("e1", device("e1")));
		await a.markSent("e1", { version: T1 });
		expect(await createOutbox(store, "b").acked()).toEqual([]);
	});
});

describe("an ack with an unknown pull", () => {
	it("fails closed: no pull of this run is later than it, and a restart reads 0", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(create("e1", device("e1")));
		await outbox.markSent("e1", { version: T1 });
		const [entry] = await outbox.acked();
		// The engine retires an entry once a finished pull is past `ack.pull`.
		expect(entry?.ack.pull).toBe(Number.POSITIVE_INFINITY);
		expect(1e9 > (entry?.ack.pull ?? 0)).toBe(false);
		expect((await createOutbox(store, "a").acked())[0]?.ack.pull).toBe(0);
	});
});

describe("undo generation", () => {
	it("undo generation survives a restart", async () => {
		const store = createMemoryStore();
		const first = createOutbox(store, "a");
		expect(await first.nextUndoGeneration("e1")).toBe(1);
		expect(await first.nextUndoGeneration("e1")).toBe(2);
		const restarted = createOutbox(store, "a");
		expect(await restarted.nextUndoGeneration("e1")).toBe(3);
		expect(await restarted.nextUndoGeneration("e2")).toBe(1);
	});
});

/** A store whose deletes fail once armed: a crash in the middle of a step. */
function crashingStore() {
	const inner = createMemoryStore();
	const state = { armed: false };
	return {
		state,
		store: {
			...inner,
			delete: async (key: string) => {
				if (state.armed) throw new Error("crash");
				await inner.delete(key);
			},
		},
	};
}

describe("a crash in the middle of a step", () => {
	const sentBy = async (outbox: ReturnType<typeof createOutbox>) => {
		const sent: string[] = [];
		await flushOutbox(outbox, async (e) => {
			sent.push(e.clientId);
			return { status: "sent", version: T2 };
		});
		return sent;
	};

	it("replace writes the new entry before it deletes the old one", async () => {
		const { store, state } = crashingStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		state.armed = true;
		await expect(outbox.replace("u1", edit("u1b", "e1", T2))).rejects.toThrow(
			"crash",
		);
		const entries = await createOutbox(store, "a").all();
		// The re-based write is not lost, and the entry after it is parked, never sent.
		expect(entries.find((e) => e.clientId === "u1b")?.baseVersion).toBe(T2);
		expect(entries.find((e) => e.clientId === "u2")).toMatchObject({
			state: "conflict",
			lastError: "expense_changed",
		});
	});

	it("a replaced entry the crash left is never sent, and is deleted on restart", async () => {
		const { store, state } = crashingStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		state.armed = true;
		await expect(outbox.replace("u1", edit("u1b", "e1", T2))).rejects.toThrow(
			"crash",
		);
		expect(await sentBy(outbox)).toEqual([]);
		state.armed = false;
		const restarted = createOutbox(store, "a");
		expect((await restarted.all()).map((e) => e.clientId)).toEqual(["u1b"]);
		expect(await sentBy(restarted)).toEqual(["u1b"]);
	});

	it("deletes a replaced leftover whose replacement is already acked", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await outbox.enqueue(
			edit("u1b", "e1", T2, booking("e1", null, bookedRow("e1"))),
		);
		await outbox.markConflict("u1", "replaced:u1b");
		await outbox.markSent("u1b", { version: T2, pull: 1 });
		expect(
			(await createOutbox(store, "a").all()).map((e) => e.clientId),
		).toEqual([]);
	});

	it("refuses a replacement under the same clientId", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await expect(outbox.replace("u1", edit("u1", "e1", T2))).rejects.toThrow(
			"new clientId",
		);
		expect((await outbox.all())[0]).toMatchObject({
			clientId: "u1",
			state: "pending",
			baseVersion: T1,
		});
	});

	it("requeue leaves a discarding or replaced entry parked", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await outbox.enqueue(edit("u2", "e2", T1));
		await outbox.enqueue(edit("u3", "e3", T1));
		await outbox.markConflict("u1", "discarding");
		await outbox.markConflict("u2", "replaced:u2b");
		await outbox.markConflict("u3", "expense_changed");
		for (const id of ["u1", "u2", "u3"]) await outbox.requeue(id);
		expect((await outbox.all()).map((e) => [e.clientId, e.state])).toEqual([
			["u1", "conflict"],
			["u2", "conflict"],
			["u3", "pending"],
		]);
	});

	it("keeps a replaced entry whose replacement never got written", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await outbox.markConflict("u1", "replaced:u1b");
		const [left] = await createOutbox(store, "a").all();
		expect(left).toMatchObject({ clientId: "u1", state: "conflict" });
	});

	it("discard re-points the next entry before it deletes", async () => {
		const { store, state } = crashingStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		state.armed = true;
		await expect(outbox.discard("u1")).rejects.toThrow("crash");
		const entries = await createOutbox(store, "a").all();
		expect(entries.find((e) => e.clientId === "u2")?.baseVersion).toBe(T1);
	});

	it("a discarded entry the crash left is never sent, and is deleted on restart", async () => {
		const { store, state } = crashingStore();
		const outbox = createOutbox(store, "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		state.armed = true;
		await expect(outbox.discard("u1")).rejects.toThrow("crash");
		expect(await sentBy(outbox)).toEqual([]);
		state.armed = false;
		const restarted = createOutbox(store, "a");
		expect((await restarted.all()).map((e) => e.clientId)).toEqual(["u2"]);
		expect(await sentBy(restarted)).toEqual(["u2"]);
	});
});

describe("chains", () => {
	it("writes the ack's version into the chained entry and its before rows", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			edit(
				"u1",
				"e1",
				T1,
				booking(
					"e1",
					bookedRow("e1", { version: T1 }),
					bookedRow("e1", { amount: "120.00" }),
				),
			),
		);
		await outbox.enqueue(
			edit(
				"u2",
				"e1",
				{ after: "u1" },
				booking(
					"e1",
					bookedRow("e1", { amount: "120.00" }),
					bookedRow("e1", { amount: "130.00" }),
				),
			),
		);
		await outbox.markSent("u1", { version: T2 });
		const [second] = await outbox.all();
		expect(second?.baseVersion).toBe(T2);
		expect(second?.device?.changes[0]?.before?.version).toBe(T2);
		expect(second?.device?.changes[0]?.after?.version).toBeNull();
	});

	it("parks an entry chained to an ack with no version", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("e1", device("e1")));
		await outbox.enqueue(edit("u1", "e1", { after: "e1" }));
		await outbox.markSent("e1", {});
		expect((await outbox.all())[0]).toMatchObject({
			state: "conflict",
			lastError: "chain_lost",
			baseVersion: { after: "e1" },
		});
	});

	it("discarding an entry re-points the next to its base", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		await outbox.discard("u1");
		expect((await outbox.all())[0]?.baseVersion).toBe(T1);
	});

	it("discarding a create parks the entries that waited on it", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("e1"));
		await outbox.enqueue(edit("u1", "e1", { after: "e1" }));
		await outbox.discard("e1");
		expect((await outbox.all())[0]).toMatchObject({
			state: "conflict",
			lastError: "chain_lost",
		});
	});

	it("replacing an entry parks every later entry for the row, and no other row", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u1", "e1", T1));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		await outbox.enqueue(edit("u3", "e2", T1));
		await outbox.enqueue(edit("u4", "e1", { after: "u2" }));
		await outbox.replace("u1", edit("u1b", "e1", T2));
		expect(
			(await outbox.all()).map((e) => [e.clientId, e.state, e.lastError]),
		).toEqual([
			["u1b", "pending", null],
			["u2", "conflict", "expense_changed"],
			["u3", "pending", null],
			["u4", "conflict", "expense_changed"],
		]);
	});
});

describe("recurring entries", () => {
	const TEMPLATE_TEXTS = [
		TEMPLATE_SENTINEL.name,
		TEMPLATE_SENTINEL.websiteUrl,
		TEMPLATE_SENTINEL.paymentSource,
		TEMPLATE_SENTINEL.category.name,
	];

	it("a confirm holds no text of the expense or of the template, each table by its own list", async () => {
		const store = createMemoryStore();
		await createOutbox(store, "a").enqueue(
			confirm("c1", "t1", T1, {
				device: confirmBooking("c1", "t1", { withText: true }),
			}),
		);
		for (const key of await store.keys("")) {
			const raw = (await store.get(key)) ?? "";
			for (const text of [...Object.values(SENTINEL), ...TEMPLATE_TEXTS])
				expect(raw).not.toContain(text);
		}
		const [expense, template] =
			(await createOutbox(store, "a").all())[0]?.device?.changes ?? [];
		expect(expense?.after).toMatchObject({ id: "c1", amount: "100.00" });
		expect(template?.after).toMatchObject({ id: "t1", autoPay: true });
	});

	it("a not-yet answer gives its send back, so the entry is not read as one that may be on the server", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(confirm("c1", "t1", T1, { origin: "poster" }));
		await outbox.markSending("c1");
		expect((await outbox.all())[0]?.attempts).toBe(1);
		await outbox.markLater("c1");
		expect((await outbox.all())[0]).toMatchObject({
			state: "pending",
			attempts: 0,
		});
	});

	it("a not-yet answer keeps the count of an earlier send whose answer was lost", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(confirm("c1", "t1", T1));
		await outbox.markSending("c1");
		await outbox.markFailed("c1", "offline");
		await outbox.markSending("c1");
		await outbox.markLater("c1");
		expect((await outbox.all())[0]?.attempts).toBe(1);
	});

	it("an unknown table throws and keeps nothing", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		const bogus = {
			bookedAt: 1,
			changed: [],
			changes: [{ table: "payoffPlans", id: "a1", before: null, after: {} }],
		};
		await expect(
			outbox.enqueue(confirm("c1", "t1", T1, { device: bogus as never })),
		).rejects.toThrow(/unknown table "payoffPlans"/);
		expect(await store.keys("")).toEqual([]);
	});

	it("a table named like an object property is still unknown", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const bogus = {
			bookedAt: 1,
			changed: [],
			changes: [{ table: "toString", id: "a1", before: null, after: {} }],
		};
		await expect(
			outbox.enqueue(confirm("c1", "t1", T1, { device: bogus as never })),
		).rejects.toThrow(/unknown table "toString"/);
	});

	it("keeps its origin across a restart, and an entry without one is a person's", async () => {
		const store = createMemoryStore();
		await createOutbox(store, "a").enqueue(
			confirm("c1", "t1", T1, { origin: "poster" }),
		);
		await createOutbox(store, "a").enqueue(confirm("c2", "t2", T1));
		const [first, second] = await createOutbox(store, "a").all();
		expect(first?.origin).toBe("poster");
		expect(second?.origin).toBeUndefined();
	});

	it("refuses a poster entry with no stamp, and keeps nothing", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		await expect(
			outbox.enqueue(confirm("c1", "t1", null, { origin: "poster" })),
		).rejects.toThrow(/needs the template's version/);
		expect(await store.keys("")).toEqual([]);
		await outbox.enqueue(confirm("c2", "t1", null));
		await outbox.enqueue(
			confirm("c3", "t1", { after: "c2" }, { origin: "poster" }),
		);
		expect((await outbox.all()).map((e) => e.clientId)).toEqual(["c2", "c3"]);
	});

	it("stamps the template row of a chained confirm and leaves the expense the first one booked alone", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			confirm("c1", "t1", T1, { device: confirmBooking("c1", "t1") }),
		);
		const next = confirmBooking("c2", "t1");
		// The second entry also names the first one's expense as a `before` row.
		next.changes = [
			{
				table: "expenses",
				id: "c1",
				before: bookedRow("c1") as never,
				after: bookedRow("c1", { amount: "5.00" }) as never,
			},
			...next.changes,
		];
		await outbox.enqueue(
			confirm("c2", "t1", { after: "c1" }, { device: next }),
		);
		await outbox.markSent("c1", { version: T2, pull: 1 });
		const second = (await outbox.all())[0];
		expect(second?.baseVersion).toBe(T2);
		const [expense, , template] = second?.device?.changes ?? [];
		expect(template?.before).toMatchObject({ id: "t1", version: T2 });
		expect(expense?.before).toMatchObject({ id: "c1", version: null });
	});

	it("keys rows by table and id: an expense and a template with one id take their own stamp", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			confirm("c1", "x", T1, { device: confirmBooking("x", "x") }),
		);
		const next = confirmBooking("c2", "x");
		next.changes = [
			{
				table: "expenses",
				id: "x",
				before: bookedRow("x") as never,
				after: bookedRow("x", { amount: "5.00" }) as never,
			},
			...next.changes.slice(1),
		];
		await outbox.enqueue(confirm("c2", "x", { after: "c1" }, { device: next }));
		await outbox.markSent("c1", { version: T2, pull: 1 });
		const [expense, template] = (await outbox.all())[0]?.device?.changes ?? [];
		expect(template?.before).toMatchObject({ version: T2 });
		expect(expense?.before).toMatchObject({ version: null });
	});

	it("an entry whose booking holds no row of its target stamps no booked row, but the base still moves", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		// The booking names the template's row, the target is another row.
		const entry = (id: string, base: string | { after: string }) =>
			confirm(id, "other", base, { device: confirmBooking(id, "t1") });
		await outbox.enqueue(entry("c1", T1));
		await outbox.enqueue(entry("c2", { after: "c1" }));
		await outbox.markSent("c1", { version: T2, pull: 1 });
		const second = (await outbox.all())[0];
		expect(second?.baseVersion).toBe(T2);
		expect(second?.device?.changes[1]?.before).toMatchObject({ version: null });
	});
});
