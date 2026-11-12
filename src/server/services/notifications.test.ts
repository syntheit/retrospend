import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	preference: vi.fn(),
	user: vi.fn(),
	create: vi.fn(),
	users: vi.fn(),
	shadows: vi.fn(),
	guests: vi.fn(),
	sendEmail: vi.fn(async () => {}),
}));

vi.mock("~/env", () => ({
	env: {
		PUBLIC_URL: "https://retro.example",
		NEXT_PUBLIC_APP_URL: "",
		UNSUBSCRIBE_SECRET: "secret-secret-secret",
	},
}));
vi.mock("~/server/db", () => ({
	db: {
		notificationPreference: { findUnique: mocks.preference },
		user: { findUnique: mocks.user, findMany: mocks.users },
		shadowProfile: { findMany: mocks.shadows },
		guestSession: { findMany: mocks.guests },
		notification: { create: mocks.create },
	},
}));
vi.mock("~/server/mailer", () => ({ sendEmail: mocks.sendEmail }));

import { createNotification, presentNotifications } from "./notifications";

const plain = (text: string) => text.replaceAll(" ", " ");

const actor = { type: "user", id: "actor1" } as const;

/** The reader's row for the reader's id, the actor's name for the actor's. */
function users(reader: object, actorName: string | null = null) {
	mocks.user.mockImplementation(async ({ where }: { where: { id: string } }) =>
		where.id === actor.id ? (actorName ? { name: actorName } : null) : reader,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.preference.mockResolvedValue(null);
});

describe("createNotification", () => {
	it("stores the notice as ids and minor amounts, with no name and no sentence", async () => {
		users({ email: null, language: "es-AR", numberFormat: null });
		await createNotification({
			userId: "u1",
			type: "SETTLEMENT_RECEIVED",
			notice: {
				kind: "settlementReceived",
				actor,
				amount: { money: { minor: 1_234_550, currency: "ARS" } },
			},
			data: { paymentGroupId: "g1" },
		});

		const row = mocks.create.mock.calls[0]?.[0].data;
		expect(row.title).toBe("");
		expect(row.body).toBe("");
		expect(row.data).toEqual({
			paymentGroupId: "g1",
			notice: {
				kind: "settlementReceived",
				actor,
				amount: { money: { minor: 1_234_550, currency: "ARS" } },
			},
		});
	});

	it("sends the same text by email, with no name of an expense or project in it", async () => {
		users(
			{ email: "ben@example.test", language: "en", numberFormat: null },
			"Ana",
		);
		await createNotification({
			userId: "u2",
			type: "EXPENSE_DELETED",
			notice: {
				kind: "expenseDeleted",
				actor,
				amount: { money: { minor: 4_500, currency: "JPY" } },
			},
		});

		const [to, subject, html] = mocks.sendEmail.mock.calls[0] as unknown as [
			string,
			string,
			string,
		];
		expect(to).toBe("ben@example.test");
		expect(subject).toBe("Retrospend: Expense deleted");
		expect(plain(html)).toContain("Ana deleted an expense of JPY 4,500");
	});

	it("stores only the listed ids and the notice, whatever else a caller hands over", async () => {
		users({ email: null, language: "en", numberFormat: null });
		const changes = {
			amount: {
				from: { minor: 100_000, currency: "ARS" },
				to: { minor: 150_000, currency: "ARS" },
			},
			payer: true,
		};
		await createNotification({
			userId: "u4",
			type: "EXPENSE_EDITED",
			notice: { kind: "expenseEdited", actor, changes },
			// What a careless caller might hand over; the type refuses it, and
			// the store drops it anyway.
			data: {
				transactionId: "t1",
				shadowName: "Gil",
				projectName: "Bariloche",
				changes: "title: Cena to Almuerzo",
				notice: { kind: "expenseDeleted" },
			} as never,
		});
		const row = mocks.create.mock.calls[0]?.[0].data;
		expect(Object.keys(row.data).sort()).toEqual(["notice", "transactionId"]);
		expect(row.data.notice).toEqual({ kind: "expenseEdited", actor, changes });
	});

	it("stores the notice as read back: a key a caller adds is dropped, a settle-all of offsets keeps 0", async () => {
		users({ email: null, language: "en", numberFormat: null });
		const money = { minor: 0, currency: "ARS" };
		await createNotification({
			userId: "u5",
			type: "SETTLEMENT_RECEIVED",
			notice: {
				kind: "settlementReceived",
				actor: { ...actor, name: "Ana" },
				amount: { money: { ...money, title: "Cena" }, currencies: 0 },
			} as never,
		});
		const row = mocks.create.mock.calls[0]?.[0].data;
		expect(row.data.notice).toEqual({
			kind: "settlementReceived",
			actor,
			amount: { money, currencies: 0 },
		});
		expect(JSON.stringify(row.data)).not.toMatch(/Ana|Cena/);
	});

	it("refuses a notice that does not match its schema: no row, no email, no throw", async () => {
		users({ email: "reader@example.com", language: "en", numberFormat: null });
		await expect(
			createNotification({
				userId: "u6",
				type: "SETTLEMENT_RECEIVED",
				notice: {
					kind: "settlementReceived",
					actor,
					amount: { money: { minor: 1.5, currency: "ARS" } },
				},
			}),
		).resolves.toBeUndefined();
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});

	it("writes nothing when the person switched the app notification off, and still never throws", async () => {
		mocks.preference.mockResolvedValue({ inApp: false, email: false });
		users({ email: null, language: "en", numberFormat: null });
		await expect(
			createNotification({
				userId: "u3",
				type: "EXPENSE_EDITED",
				notice: { kind: "expenseEdited", actor },
			}),
		).resolves.toBeUndefined();
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});
});

describe("presentNotifications", () => {
	const row = (id: string, notice: unknown, actorId: string) => ({
		id,
		title: "",
		body: "",
		data: { transactionId: id, notice: notice && { ...(notice as object), actor: { type: "user", id: actorId } } },
	});

	it("looks the actors up once for the whole page, each id once, and skips a deleted account", async () => {
		mocks.users.mockResolvedValue([
			{ id: "a", name: "Ana" },
			{ id: "b", name: "Ben" },
		]);
		const rows = await presentNotifications(
			[
				row("r1", { kind: "periodClosed" }, "a"),
				row("r2", { kind: "periodClosed" }, "b"),
				row("r3", { kind: "periodClosed" }, "a"),
				row("r4", { kind: "periodClosed" }, "DELETED_USER"),
			],
			{ language: "en" },
		);
		expect(mocks.users).toHaveBeenCalledTimes(1);
		expect(mocks.users.mock.calls[0]?.[0].where).toEqual({
			id: { in: ["a", "b"] },
		});
		expect(mocks.shadows).not.toHaveBeenCalled();
		expect(mocks.guests).not.toHaveBeenCalled();
		expect(rows.map((r) => r.body)).toEqual([
			"Ana closed a period in a project you are in",
			"Ben closed a period in a project you are in",
			"Ana closed a period in a project you are in",
			"Someone closed a period in a project you are in",
		]);
	});

	it("leaves a row without a notice as stored, and never hands out a notice it cannot read", async () => {
		const legacy = { id: "l", title: "Old", body: "Old body", data: { transactionId: "l" } };
		const broken = {
			id: "x",
			title: "",
			body: "",
			data: { transactionId: "x", notice: { kind: "gone", actor: { type: "user", id: "a" } } },
		};
		const out = await presentNotifications([legacy, broken], { language: "en" });
		expect(out).toEqual([legacy, { ...broken, data: { transactionId: "x" } }]);
		expect(mocks.users).not.toHaveBeenCalled();
	});

	it("reads a settle-all of offsets (0 currencies) like a payment in one currency", async () => {
		mocks.users.mockResolvedValue([{ id: "a", name: "Ana" }]);
		const amount = (currencies?: number) => ({
			money: { minor: 0, currency: "ARS" },
			...(currencies === undefined ? {} : { currencies }),
		});
		const [zero, one] = await presentNotifications(
			[
				row("z", { kind: "settlementReceived", amount: amount(0) }, "a"),
				row("o", { kind: "settlementReceived", amount: amount() }, "a"),
			],
			{ language: "en" },
		);
		expect(zero?.body).not.toBe("");
		expect(zero?.body).toBe(one?.body);
		expect(plain(zero?.body ?? "")).toMatch(/^Ana .*ARS\s?0/);
	});
});
