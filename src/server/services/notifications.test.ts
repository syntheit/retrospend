import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	preference: vi.fn(),
	user: vi.fn(),
	create: vi.fn(),
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
		user: { findUnique: mocks.user },
		notification: { create: mocks.create },
	},
}));
vi.mock("~/server/mailer", () => ({ sendEmail: mocks.sendEmail }));

import { createNotification } from "./notifications";

const plain = (text: string) => text.replaceAll(" ", " ");

beforeEach(() => {
	vi.clearAllMocks();
	mocks.preference.mockResolvedValue(null);
});

describe("createNotification", () => {
	it("writes the text the notice makes, in the reader's language and number format", async () => {
		mocks.user.mockResolvedValue({
			email: "sofia@example.test",
			language: "es-AR",
			numberFormat: null,
		});
		await createNotification({
			userId: "u1",
			type: "SETTLEMENT_RECEIVED",
			notice: {
				kind: "settlementReceived",
				actor: "Martín",
				amount: { money: { minor: 1_234_550, currency: "ARS" } },
			},
			data: { paymentGroupId: "g1" },
		});

		const row = mocks.create.mock.calls[0]?.[0].data;
		expect(row.title).toBe("Liquidación recibida");
		expect(plain(row.body)).toBe(
			"Martín te envió una liquidación de ARS 12.345,50",
		);
		expect(row.data).toEqual({ paymentGroupId: "g1" });
	});

	it("sends the same text by email, with no name of an expense or project in it", async () => {
		mocks.user.mockResolvedValue({
			email: "ben@example.test",
			language: "en",
			numberFormat: null,
		});
		await createNotification({
			userId: "u2",
			type: "EXPENSE_DELETED",
			notice: {
				kind: "expenseDeleted",
				actor: "Ana",
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

	it("stores only the listed ids and the edit summary it makes itself", async () => {
		mocks.user.mockResolvedValue({
			email: null,
			language: "en",
			numberFormat: null,
		});
		await createNotification({
			userId: "u4",
			type: "EXPENSE_EDITED",
			notice: {
				kind: "expenseEdited",
				actor: "Ana",
				changes: {
					amount: {
						from: { minor: 100_000, currency: "ARS" },
						to: { minor: 150_000, currency: "ARS" },
					},
					payer: true,
				},
			},
			// What a careless caller might hand over; the type refuses it, and
			// the store drops it anyway.
			data: {
				transactionId: "t1",
				shadowName: "Gil",
				projectName: "Bariloche",
				changes: "title: Cena to Almuerzo",
			} as never,
		});
		const row = mocks.create.mock.calls[0]?.[0].data;
		expect(Object.keys(row.data).sort()).toEqual(["changes", "transactionId"]);
		expect(plain(row.data.changes)).toBe(
			"amount: ARS 1,000 to ARS 1,500, payer changed",
		);
	});

	it("writes nothing when the person switched the app notification off, and still never throws", async () => {
		mocks.preference.mockResolvedValue({ inApp: false, email: false });
		mocks.user.mockResolvedValue({
			email: null,
			language: "en",
			numberFormat: null,
		});
		await expect(
			createNotification({
				userId: "u3",
				type: "EXPENSE_EDITED",
				notice: { kind: "expenseEdited", actor: "Ana" },
			}),
		).resolves.toBeUndefined();
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});
});
