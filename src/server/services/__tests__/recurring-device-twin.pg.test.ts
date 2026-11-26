/**
 * The same recurring writes through the real server (v1) and the device
 * engine, on one ARS home at blue, compared the way the phone compares an
 * acked write (write-parity.ts `compareEntry`) against what a fresh pull of
 * the server brings. Hand-derived values (slice-device-recurring.md, test plan):
 *   blue 1,545 from Nov 30 (1,540 on Nov 29), official 1,050 from Dec 1;
 *   a monthly USD 20 template on the 1st, due 2026-12-01T03:00Z (the start of
 *   Dec 1 in Buenos Aires, UTC-3); a post books 20 * 1,545 = ARS 30,900.00
 *   (official would give 21,000.00) and the template steps to 2027-01-01T03:00Z;
 *   paid on Nov 29: 20 * 1,540 = 30,800.00 dated 2026-11-29T03:00Z;
 *   ASK, USD 18.50: 18.5 * 1,545 = 28,582.50;
 *   JPY home at 150: USD 8.35 = 1,252.5, a tie half to even takes to 1,252
 *   (half up would give 1,253);
 *   catch-up due Sep 1, Oct 1, Nov 1 at blue 1,500, 1,520, 1,545: 30,000 +
 *   30,400 + 30,900 = 91,300.00 (today's 1,545 for all three: 92,700.00);
 *   weekly from Jan 7, 40 periods due at Oct 10: 31 post (31 * 30,900 =
 *   957,900.00, due Aug 12 after), then 9 (278,100.00, due Oct 14).
 * The device books under the server's expense id, so the pulled row is the one
 * it compares with.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expectBody } from "~/server/api/v1/core/__tests__/harness";
import { expectedCounts, newDevice, pullAll } from "~/test/parity/pull";
import {
	adminDb,
	createTestUser,
	fixtureDb,
	fixtureNameIndex,
} from "~/test/pg-harness";
import { bookedChangesOf } from "../../../../packages/engine/src/device/book";
import type { PendingChange } from "../../../../packages/engine/src/device/pending";
import { LocalDb } from "../../../../packages/engine/src/local-db";
import type { MemoryStore } from "../../../../packages/engine/src/memory-store";
import { SETTINGS_ID } from "../../../../packages/engine/src/port";
import {
	confirmRecurring,
	planPosterOver,
	RECURRING_CONFIRM,
	RECURRING_SKIP,
	skipRecurring,
} from "../../../../packages/engine/src/recurring-local";
import {
	createTemplate,
	TEMPLATE_CREATE,
	TEMPLATE_UPDATE,
	updateTemplate,
} from "../../../../packages/engine/src/template-local";
import {
	compareEntry,
	differingWriteFields,
	type WriteVerdict,
} from "../../../../packages/engine/src/write-parity";
import { sweepRecurringAutoPost } from "../recurring-auto-post";
import {
	arsUser,
	BA,
	booked,
	iso,
	STAMPED,
	setRates,
	sweepOnly,
	TOKYO,
	templateState,
	usdTemplate,
	v1For,
	v1TemplateBody,
} from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

declare const process: { env: Record<string, string | undefined> };

const NOW = new Date("2026-12-01T12:00:00.000Z");
const DUE = "2026-12-01T03:00:00.000Z";
const NEXT = "2027-01-01T03:00:00.000Z";

const at = (instant: Date) =>
	vi.useFakeTimers({ toFake: ["Date"], now: instant });
afterEach(() => vi.useRealTimers());

/**
 * The rate table, stamped long before any booking here: the compare skips a
 * write whose rates were rewritten within five minutes of it (`rates_moved`),
 * and these were written moments ago on the real clock.
 */
async function settledRates(rows: Parameters<typeof setRates>[0]) {
	await setRates(rows);
	await adminDb.exchangeRate.updateMany({
		data: { updatedAt: new Date("2026-01-01T00:00:00.000Z") },
	});
}

/** A fresh device's store after a pull of the server as it stands at `now`, through the real v1 sync routes. */
async function pulled(userId: string, now: Date): Promise<MemoryStore> {
	at(now);
	try {
		const device = await newDevice(userId);
		await pullAll(device, await expectedCounts(userId), { shares: false });
		return device.store;
	} finally {
		vi.useRealTimers();
	}
}

/** Runs `fn` with the process zone set, restored after: a phone, and a server that read its own zone, would book another day. */
async function underTZ<T>(zone: string | undefined, fn: () => Promise<T>) {
	const before = process.env.TZ;
	if (zone) process.env.TZ = zone;
	try {
		return await fn();
	} finally {
		if (before === undefined) delete process.env.TZ;
		else process.env.TZ = before;
	}
}

/** The device's write over a pull of the server before it: the rows it changed, as an outbox entry keeps them. */
async function onDevice<_V>(
	userId: string,
	now: Date,
	mutation: string,
	write: Parameters<LocalDb["write"]>[1],
	prepare?: (store: MemoryStore) => Promise<void>,
) {
	const store = await pulled(userId, now);
	await prepare?.(store);
	const { undo } = await new LocalDb(store).write(mutation, write);
	return { changes: bookedChangesOf(undo) as PendingChange[], store };
}

/** What the phone does when a pull has seen an acked write: compare it with the pulled rows. */
async function compared(
	userId: string,
	now: Date,
	changes: PendingChange[],
	version: string | null,
	expenseVersion?: string | null,
): Promise<WriteVerdict[]> {
	const live = await pulled(userId, now);
	return compareEntry(live.snapshot(), changes, {
		bookedAt: now.getTime(),
		version,
		...(expenseVersion ? { expenseVersion } : {}),
	});
}

const match = (id: string): WriteVerdict => ({ id, outcome: "match" });

type Confirmed = {
	confirmed: {
		templateUpdatedAt: string | null;
		expenseUpdatedAt?: string | null;
	};
};
type V1 = Awaited<ReturnType<typeof v1For>>;

async function confirmAnswer(
	v1: V1,
	id: string,
	body: object,
	now = NOW,
): Promise<Confirmed["confirmed"]> {
	at(now);
	try {
		const done = await expectBody<Confirmed>(
			await v1("POST", `/recurring/${id}/confirm`, body),
			contract.recurring.confirm,
		);
		return done.confirmed;
	} finally {
		vi.useRealTimers();
	}
}

const confirmOnServer = async (...args: Parameters<typeof confirmAnswer>) =>
	(await confirmAnswer(...args)).templateUpdatedAt;

describe("one period, confirmed on both", () => {
	beforeAll(() =>
		settledRates([
			["2026-11-29", "ARS", "blue", "1540"],
			["2026-11-30", "ARS", "blue", "1545"],
			["2026-12-01", "ARS", "official", "1050"],
		]),
	);

	/** The device and v1 confirm the same period; returns the verdicts and the stored row. */
	async function confirmBoth(opts: {
		zone?: string;
		template?: Parameters<typeof usdTemplate>[1];
		device?: Partial<Parameters<typeof confirmRecurring>[0]>;
		body?: object;
		now?: Date;
		process?: string;
		prepare?: (store: MemoryStore) => Promise<void>;
	}) {
		const now = opts.now ?? NOW;
		const me = await arsUser(opts.zone);
		const id = await usdTemplate(me, opts.template);
		const clientId = randomUUID();
		const { changes } = await underTZ(opts.process, () =>
			onDevice(
				me,
				now,
				RECURRING_CONFIRM,
				confirmRecurring({ templateId: id, now, clientId, ...opts.device }),
				opts.prepare,
			),
		);
		const answer = await underTZ(opts.process, async () =>
			confirmAnswer(
				await v1For(me, opts.zone),
				id,
				{ dueAt: DUE, expenseId: clientId, ...opts.body },
				now,
			),
		);
		return {
			me,
			id,
			clientId,
			changes,
			answer,
			verdicts: await compared(
				me,
				now,
				changes,
				answer.templateUpdatedAt,
				answer.expenseUpdatedAt,
			),
		};
	}

	it("a fixed amount: ARS 30,900.00 at blue, the template one period on, every compared field the same", async () => {
		const { me, id, clientId, verdicts, answer } = await confirmBoth({});
		expect(verdicts).toEqual([match(clientId), match(id)]);
		// The answer names the booked expense's own updatedAt, as stored.
		const stored = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: clientId },
		});
		expect(answer.expenseUpdatedAt).toBe(iso(stored.updatedAt));
		expect(await booked(me)).toMatchObject([
			{
				date: DUE,
				amount: "20",
				usd: "20",
				rateType: "blue",
				homeRate: "1545",
				home: "30900",
				recurringTemplateId: id,
			},
		]);
		expect((await templateState(id)).nextDueDate).toBe(NEXT);
	});

	it("an amount that varies: USD 18.50 books ARS 28,582.50", async () => {
		const { me, id, clientId, verdicts } = await confirmBoth({
			template: { amountMode: "ASK", autoPay: false },
			device: { confirmedAmount: "18.50" },
			body: { amount: "18.50" },
		});
		expect(verdicts).toEqual([match(clientId), match(id)]);
		expect(await booked(me)).toMatchObject([
			{ amount: "18.5", home: "28582.5" },
		]);
	});

	it("paid on Nov 29: the day's blue 1,540 gives ARS 30,800.00 dated Nov 29, and the template still steps from the due date", async () => {
		const { me, id, clientId, verdicts } = await confirmBoth({
			device: { paidOn: "2026-11-29" },
			body: { paidOn: "2026-11-29" },
		});
		expect(verdicts).toEqual([match(clientId), match(id)]);
		expect(await booked(me)).toMatchObject([
			{ date: "2026-11-29T03:00:00.000Z", homeRate: "1540", home: "30800" },
		]);
		expect((await templateState(id)).nextDueDate).toBe(NEXT);
	});

	it("a device in UTC and one in Tokyo post the same row at 03:00Z", async () => {
		for (const zone of ["UTC", TOKYO]) {
			const { me, id, clientId, verdicts } = await confirmBoth({
				process: zone,
			});
			expect(verdicts, zone).toEqual([match(clientId), match(id)]);
			expect(await booked(me), zone).toMatchObject([
				{ date: DUE, home: "30900" },
			]);
		}
	});

	it("nothing is due at 02:00Z in Buenos Aires on either side, whatever zone the process is in", async () => {
		for (const zone of ["UTC", TOKYO]) {
			const me = await arsUser();
			const id = await usdTemplate(me);
			const early = new Date("2026-12-01T02:00:00.000Z");
			await underTZ(zone, async () => {
				await expect(
					onDevice(
						me,
						early,
						RECURRING_CONFIRM,
						confirmRecurring({ templateId: id, now: early, clientId: "x" }),
					),
				).rejects.toMatchObject({ kind: "not_due" });
				at(early);
				const res = await (await v1For(me))(
					"POST",
					`/recurring/${id}/confirm`,
					{ dueAt: DUE },
				);
				expect(res.status).toBe(409);
				expect(await res.json()).toMatchObject({ code: "recurring_not_due" });
			});
			expect(await booked(me)).toEqual([]);
		}
	});

	it("a saved zone of Tokyo: a manual confirm from Tokyo at Nov 30 15:30Z passes, and the next due date is Dec 31 15:00Z", async () => {
		const now = new Date("2026-11-30T15:30:00.000Z");
		const { id, clientId, verdicts } = await confirmBoth({
			zone: TOKYO,
			now,
			device: { zone: TOKYO },
		});
		expect(verdicts).toEqual([match(clientId), match(id)]);
		expect((await templateState(id)).nextDueDate).toBe(
			"2026-12-31T15:00:00.000Z",
		);
	});

	it("skip steps the template and books nothing, the same on both", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me);
		const { changes } = await onDevice(
			me,
			NOW,
			RECURRING_SKIP,
			skipRecurring({ templateId: id, now: NOW }),
		);
		at(NOW);
		const done = await expectBody<{ skipped: { templateUpdatedAt: string } }>(
			await (await v1For(me))("POST", `/recurring/${id}/skip`, { dueAt: DUE }),
			contract.recurring.skip,
		);
		vi.useRealTimers();
		expect(await booked(me)).toEqual([]);
		expect(
			await compared(me, NOW, changes, done.skipped.templateUpdatedAt),
		).toEqual([match(id)]);
		expect((await templateState(id)).nextDueDate).toBe(NEXT);
	});

	describe("what the compare catches", () => {
		it("a device that books at the official rate: the rate type, the rate and the home amount differ", async () => {
			const { id, clientId, verdicts } = await confirmBoth({
				// The device's preference is official (1,050 on Dec 1): ARS 21,000.00.
				prepare: async (store) => {
					await store.transaction((tx) => {
						const s = tx.get("settings", SETTINGS_ID);
						if (s)
							tx.put("settings", {
								...s,
								defaultRateTypes: { ARS: "official" },
							});
					});
				},
			});
			expect(verdicts).toEqual([
				{
					id: clientId,
					outcome: "differs",
					fields: ["rateType", "homeRate", "homeAmount"],
				},
				match(id),
			]);
		});

		// Each compared template column on its own: the device edits it, the server
		// is given another value (or none), and the compare names exactly that column.
		const COLUMNS: [string, string[], object, object][] = [
			["amount", ["amount"], { amount: "25" }, { amount: "26" }],
			["currency", ["currency"], { currency: "EUR" }, { currency: "GBP" }],
			[
				"frequency",
				["frequency"],
				{ frequency: "WEEKLY" },
				{ frequency: "BIWEEKLY" },
			],
			["isActive", ["isActive"], { isActive: false }, {}],
			["autoPay", ["autoPay"], { autoPay: false }, {}],
			["amountMode", ["amountMode"], { amountMode: "ASK" }, {}],
			[
				"nextDueDate",
				["nextDueDate", "anchorDay"],
				{ nextDueDate: "2026-12-15" },
				{ nextDueDate: "2026-12-16" },
			],
		];
		for (const [column, fields, device, server] of COLUMNS)
			it(`a template edit that differs in ${column} names ${fields.join(" and ")}`, async () => {
				const me = await arsUser();
				const id = await usdTemplate(me);
				const { changes } = await onDevice(
					me,
					NOW,
					TEMPLATE_UPDATE,
					updateTemplate({ id, ...device }),
				);
				// The server edits a column the compare does not read, so its row differs only where `server` says.
				const res = await (await v1For(me))(
					"PATCH",
					`/recurring/${id}`,
					v1TemplateBody({ name: "Gym", ...server }),
				);
				expect(res.status, await res.clone().text()).toBe(200);
				expect(await compared(me, NOW, changes, null)).toEqual([
					{ id, outcome: "differs", fields },
				]);
			});

		it("a template edit that differs in the category names categoryId", async () => {
			const me = await arsUser();
			const id = await usdTemplate(me);
			const name = "Housing";
			const category = await fixtureDb.category.create({
				data: {
					userId: me,
					name,
					color: "teal",
					kind: "EXPENSE",
					nameIndex: await fixtureNameIndex(me, name),
				},
			});
			const { changes } = await onDevice(
				me,
				NOW,
				TEMPLATE_UPDATE,
				updateTemplate({ id, categoryId: category.id }),
			);
			await (await v1For(me))("PATCH", `/recurring/${id}`, { name: "Gym" });
			expect(await compared(me, NOW, changes, null)).toEqual([
				{ id, outcome: "differs", fields: ["categoryId"] },
			]);
		});

		it("an expense edited on the web after the confirm is skipped as changed since, not a difference", async () => {
			const { me, changes, id, clientId, answer } = await confirmBoth({});
			await fixtureDb.expense.update({
				where: { id: clientId },
				data: { homeRate: "1050", homeAmount: "21000" },
			});
			expect(
				await compared(
					me,
					NOW,
					changes,
					answer.templateUpdatedAt,
					answer.expenseUpdatedAt,
				),
			).toEqual([
				{ id: clientId, outcome: "skipped", code: "changed_since" },
				match(id),
			]);
			// An older server names no expense version: the edit shows as a difference, never a match.
			expect(
				await compared(me, NOW, changes, answer.templateUpdatedAt),
			).toEqual([
				{
					id: clientId,
					outcome: "differs",
					fields: ["homeRate", "homeAmount"],
				},
				match(id),
			]);
		});

		it("a posted row that lost its template link names recurringTemplateId", async () => {
			const { me, changes, id, clientId } = await confirmBoth({});
			const unlinked = changes.map((c) =>
				c.table === "expenses" && c.after
					? { ...c, after: { ...c.after, recurringTemplateId: null } }
					: c,
			);
			expect(await compared(me, NOW, unlinked, null)).toEqual([
				{ id: clientId, outcome: "differs", fields: ["recurringTemplateId"] },
				match(id),
			]);
		});
	});
});

describe("a JPY home at 150", () => {
	beforeAll(() => settledRates([["2026-11-30", "JPY", "official", "150"]]));

	it("USD 8.35 books JPY 1,252 on both (half to even), and a device row rounded half up is a finding", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "JPY", timeZone: "UTC", defaultRateTypes: {} },
		});
		const due = new Date("2026-12-01T00:00:00.000Z");
		const id = await usdTemplate(user.id, { amount: "8.35", nextDueDate: due });
		const clientId = randomUUID();
		const { changes } = await onDevice(
			user.id,
			NOW,
			RECURRING_CONFIRM,
			confirmRecurring({ templateId: id, now: NOW, clientId }),
		);
		const version = await confirmOnServer(await v1For(user.id), id, {
			dueAt: iso(due),
			expenseId: clientId,
		});
		expect(await booked(user.id)).toMatchObject([
			{ homeRate: "150", home: "1252" },
		]);
		expect(await compared(user.id, NOW, changes, version)).toEqual([
			match(clientId),
			match(id),
		]);
		const roundedUp = changes.map((c) =>
			c.table === "expenses" && c.after
				? { ...c, after: { ...c.after, homeAmount: "1253" } }
				: c,
		);
		expect(await compared(user.id, NOW, roundedUp, version)).toEqual([
			{ id: clientId, outcome: "differs", fields: ["homeAmount"] },
			match(id),
		]);
	});
});

describe("the poster's run", () => {
	/** The device plans a run over a pull and books one confirm per entry. */
	async function posterOnDevice(userId: string, id: string, now: Date) {
		const store = await pulled(userId, now);
		const db = new LocalDb(store);
		const run = await planPosterOver(db.reads(), {
			templateId: id,
			now,
			autoPost: true,
			isProtected: async () => false,
		});
		const entries: {
			clientId: string;
			dueAt: Date;
			changes: PendingChange[];
		}[] = [];
		for (const entry of run.entries) {
			const clientId = randomUUID();
			const { undo } = await db.write(
				RECURRING_CONFIRM,
				confirmRecurring({
					templateId: id,
					now,
					clientId,
					dueAt: entry.dueAt,
					auto: true,
					expectedVersion:
						"version" in entry.expectedStamp
							? entry.expectedStamp.version
							: undefined,
				}),
			);
			entries.push({
				clientId,
				dueAt: entry.dueAt,
				changes: bookedChangesOf(undo) as PendingChange[],
			});
		}
		return { entries, stopped: run.stopped };
	}

	/** The phone's sender: each entry is a confirm with its due date, its client id and the stamp the answer before named. */
	async function sendOnServer(
		userId: string,
		id: string,
		now: Date,
		entries: { clientId: string; dueAt: Date }[],
		stamp: string,
	) {
		const v1 = await v1For(userId);
		const answers: (string | null)[] = [];
		let expected = stamp;
		for (const [i, e] of entries.entries()) {
			// A second apart, so each confirm leaves its own template stamp.
			const next = await confirmOnServer(
				v1,
				id,
				{
					dueAt: iso(e.dueAt),
					expenseId: e.clientId,
					expectedUpdatedAt: expected,
				},
				new Date(now.getTime() + i * 1000),
			);
			answers.push(next);
			if (next) expected = next;
		}
		return answers;
	}

	/** One verdict row per entry: the template matches only where the pull still shows the entry's own result. */
	async function expectRun(
		userId: string,
		id: string,
		now: Date,
		entries: { clientId: string; changes: PendingChange[] }[],
		answers: (string | null)[],
	) {
		const live = (await pulled(userId, now)).snapshot();
		entries.forEach((e, i) => {
			const last = i === entries.length - 1;
			expect(
				compareEntry(live, e.changes, {
					bookedAt: now.getTime(),
					version: answers[i] ?? null,
				}),
				`entry ${i + 1}`,
			).toEqual([
				match(e.clientId),
				last ? match(id) : { id, outcome: "skipped", code: "changed_since" },
			]);
		});
	}

	describe("three periods due at their own rates", () => {
		const midNov = new Date("2026-11-15T12:00:00.000Z");
		beforeAll(() =>
			settledRates([
				["2026-09-01", "ARS", "blue", "1500"],
				["2026-10-01", "ARS", "blue", "1520"],
				["2026-11-01", "ARS", "blue", "1545"],
			]),
		);
		const sepDue = new Date("2026-09-01T03:00:00.000Z");

		it("the device's entries and v1's confirms match: ARS 30,000.00 + 30,400.00 + 30,900.00, not 92,700.00", async () => {
			const me = await arsUser();
			const id = await usdTemplate(me, { nextDueDate: sepDue });
			const { entries, stopped } = await posterOnDevice(me, id, midNov);
			expect(entries).toHaveLength(3);
			expect(stopped).toBe("caught_up");
			const answers = await sendOnServer(me, id, midNov, entries, iso(STAMPED));
			await expectRun(me, id, midNov, entries, answers);
			expect((await booked(me)).map((r) => r.home)).toEqual([
				"30000",
				"30400",
				"30900",
			]);
			expect((await templateState(id)).nextDueDate).toBe(DUE);
		});

		it("the server's own sweep books the rows the device planned, field by field", async () => {
			const me = await arsUser();
			const id = await usdTemplate(me, { nextDueDate: sepDue });
			const { entries } = await posterOnDevice(me, id, midNov);
			at(midNov);
			await sweepRecurringAutoPost(midNov, sweepOnly(me));
			vi.useRealTimers();
			const live = await pulled(me, midNov);
			const server = [...live.list("expenses")].sort(
				(a, b) => a.date.getTime() - b.date.getTime(),
			);
			expect(server).toHaveLength(3);
			entries.forEach((e, i) => {
				const device = e.changes.find((c) => c.table === "expenses")?.after;
				if (!device || !server[i]) throw new Error("no row");
				expect(
					differingWriteFields(device as never, server[i]),
					`period ${i + 1}`,
				).toEqual([]);
			});
			expect((await templateState(id)).nextDueDate).toBe(DUE);
		});
	});

	describe("the cap", () => {
		const read = new Date("2026-10-10T12:00:00.000Z");
		beforeAll(() => settledRates([["2026-01-01", "ARS", "blue", "1545"]]));

		it("31 entries, then 9 after a pull: ARS 957,900.00 then 278,100.00, each compared", async () => {
			const me = await arsUser();
			const id = await usdTemplate(me, {
				frequency: "WEEKLY",
				anchorDay: null,
				nextDueDate: new Date("2026-01-07T03:00:00.000Z"),
			});
			const first = await posterOnDevice(me, id, read);
			expect(first.entries).toHaveLength(31);
			expect(first.stopped).toBe("cap");
			const answers = await sendOnServer(
				me,
				id,
				read,
				first.entries,
				iso(STAMPED),
			);
			await expectRun(me, id, read, first.entries, answers);
			expect((await templateState(id)).nextDueDate).toBe(
				"2026-08-12T03:00:00.000Z",
			);

			const second = await posterOnDevice(me, id, read);
			expect(second.entries).toHaveLength(9);
			expect(second.stopped).toBe("caught_up");
			const stamp = (await templateState(id)).updatedAt;
			const answers2 = await sendOnServer(me, id, read, second.entries, stamp);
			await expectRun(me, id, read, second.entries, answers2);
			expect((await templateState(id)).nextDueDate).toBe(
				"2026-10-14T03:00:00.000Z",
			);
			const homes = (await booked(me)).map((r) => Number(r.home));
			expect(homes).toHaveLength(40);
			expect(homes.slice(0, 31).reduce((a, b) => a + b, 0)).toBe(957900);
			expect(homes.slice(31).reduce((a, b) => a + b, 0)).toBe(278100);
		});
	});
});

describe("a template created, edited and paused", () => {
	beforeAll(() => settledRates([["2026-11-30", "ARS", "blue", "1545"]]));

	async function createBoth(zone: string) {
		const me = await arsUser(zone);
		const id = randomUUID();
		const input = {
			name: "Gym",
			amount: "35.50",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate: "2026-12-15",
		} as const;
		const { changes } = await onDevice(
			me,
			NOW,
			TEMPLATE_CREATE,
			createTemplate({ ...input, id }),
		);
		at(NOW);
		const res = await (await v1For(me, zone))(
			"POST",
			"/recurring",
			v1TemplateBody({ ...input, id }),
		);
		vi.useRealTimers();
		expect(res.status, await res.clone().text()).toBeLessThan(300);
		const made = (await res.json()) as { updatedAt: string };
		return { me, id, changes, version: made.updatedAt };
	}

	it("a create, in Buenos Aires and in Tokyo, stores the same template on both", async () => {
		for (const zone of [BA, TOKYO]) {
			const { me, id, changes, version } = await createBoth(zone);
			expect(await compared(me, NOW, changes, version), zone).toEqual([
				match(id),
			]);
		}
	});

	it("an edit and a pause land the same: amount, frequency, due day and isActive", async () => {
		const me = await arsUser(BA);
		const id = await usdTemplate(me);
		const edit = {
			id,
			amount: "25",
			frequency: "WEEKLY",
			nextDueDate: "2026-12-16",
			isActive: false,
		} as const;
		const { changes } = await onDevice(
			me,
			NOW,
			TEMPLATE_UPDATE,
			updateTemplate(edit),
		);
		at(NOW);
		const { id: _id, ...patch } = edit;
		const res = await (await v1For(me))(
			"PATCH",
			`/recurring/${id}`,
			v1TemplateBody(patch),
		);
		vi.useRealTimers();
		expect(res.status, await res.clone().text()).toBe(200);
		const state = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect([
			state.amount.toFixed(),
			state.frequency,
			state.isActive,
			iso(state.nextDueDate),
			state.anchorDay,
		]).toEqual(["25", "WEEKLY", false, "2026-12-16T03:00:00.000Z", 16]);
		expect(
			await compared(
				me,
				NOW,
				changes,
				((await res.json()) as { updatedAt: string }).updatedAt,
			),
		).toEqual([match(id)]);
	});
});
