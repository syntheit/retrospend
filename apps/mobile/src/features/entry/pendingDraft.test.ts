import type { OutboxEntry } from "@/data/outbox";
import {
	buildExpenseWrite,
	buildIncomeWrite,
	buildTransferWrite,
	newExpenseDraft,
	newIncomeDraft,
	newTransferDraft,
	type PendingWrite,
} from "./draft";
import { canRestore, restoreDraft } from "./pendingDraft";
import type { EntryCatalog } from "./types";

// Editing an entry that waits on the phone: the composer opens on the write
// the outbox holds. Rebuilding the write from the restored draft gives the
// same body back, so Save replaces it without changing what was not edited.

const catalog: EntryCatalog = {
	categories: [
		{
			id: "food",
			name: "Food",
			icon: null,
			tone: 3,
			uses: 1,
			excludeByDefault: false,
		},
	],
	people: [{ type: "user", id: "lucia1", name: "Lucía", imageUrl: null }],
	currencies: ["JPY", "USD"],
	recentCurrencies: [],
	places: [
		{ id: "a1", name: "Checking", type: "CHECKING", currency: "USD" },
		{ id: "a2", name: "Yen", type: "SAVINGS", currency: "JPY" },
	],
	projects: [],
	hasBudget: null,
};
const input = { locale: "en-US", meId: "me1", catalog };
const base = { id: "c1", date: "2026-11-02" };

function waiting(write: PendingWrite): OutboxEntry {
	return {
		clientId: String(write.body.id),
		entity: write.entity,
		kind: "create",
		targetId: String(write.body.id),
		baseVersion: null,
		payload: write.body,
		createdAt: "2026-11-02T10:00:00.000Z",
		attempts: 1,
		networkFailures: 1,
		serverErrors: 0,
		state: "failed",
		lastError: "Network request failed",
	};
}

describe("restoring a waiting write as a draft", () => {
	it("gives an expense back as it was written", () => {
		const draft = {
			...newExpenseDraft({ ...base, currency: "JPY" }),
			amountText: "1,500",
			title: "Ramen",
			categoryId: "food",
			location: "Shibuya",
			note: "with soup",
			spread: 3,
			rateType: "official",
		};
		const write = buildExpenseWrite(draft, input) as PendingWrite;
		const restored = restoreDraft(waiting(write), {
			locale: "en-US",
			meId: "me1",
		});
		expect(restored?.mode).toBe("expense");
		const again = buildExpenseWrite(restored?.expense as never, input);
		expect(again?.body).toEqual(write.body);
	});

	it("keeps a typed rate exactly as it was sent", () => {
		const draft = {
			...newExpenseDraft({ ...base, currency: "JPY" }),
			amountText: "1,500",
			title: "Ramen",
			categoryId: "food",
			custom: true,
			customText: "0.0071",
			customFlipped: false,
			customEdited: true,
		};
		const write = buildExpenseWrite(draft, input) as PendingWrite;
		const restored = restoreDraft(waiting(write), {
			locale: "en-US",
			meId: "me1",
		});
		const again = buildExpenseWrite(restored?.expense as never, input);
		expect(again?.body.customRate).toBe(write.body.customRate);
	});

	it("gives income back", () => {
		const draft = {
			...newIncomeDraft({ ...base, currency: "USD", usePlan: false }),
			amountText: "1,000",
			source: "Salary",
			note: "November",
		};
		const write = buildIncomeWrite(draft, {
			locale: "en-US",
			hasBudget: null,
		}) as PendingWrite;
		const restored = restoreDraft(waiting(write), {
			locale: "en-US",
			meId: "me1",
		});
		expect(restored?.mode).toBe("income");
		const again = buildIncomeWrite(restored?.income as never, {
			locale: "en-US",
			hasBudget: null,
		});
		expect(again?.body).toEqual(write.body);
	});

	it("gives a transfer back", () => {
		const draft = {
			...newTransferDraft({ ...base, currency: "USD", places: catalog.places }),
			amountText: "50",
			receivedText: "7,500",
			note: "yen",
		};
		const write = buildTransferWrite(draft, {
			locale: "en-US",
			places: catalog.places,
		}) as PendingWrite;
		const restored = restoreDraft(waiting(write), {
			locale: "en-US",
			meId: "me1",
		});
		expect(restored?.mode).toBe("transfer");
		const again = buildTransferWrite(restored?.transfer as never, {
			locale: "en-US",
			places: catalog.places,
		});
		expect(again?.body).toEqual(write.body);
	});

	it("gives an equal split back, with who it is shared with", () => {
		const draft = {
			...newExpenseDraft({ ...base, currency: "USD" }),
			amountText: "40",
			title: "Dinner",
			categoryId: "food",
			withKeys: ["user:lucia1"],
		};
		const write = buildExpenseWrite(draft, input) as PendingWrite;
		expect(write.entity).toBe("shared-expenses");
		const restored = restoreDraft(waiting(write), {
			locale: "en-US",
			meId: "me1",
		});
		const again = buildExpenseWrite(restored?.expense as never, input);
		expect(again?.body).toEqual(write.body);
	});

	it("does not rebuild a custom split: it is deleted and added again", () => {
		const draft = {
			...newExpenseDraft({ ...base, currency: "USD" }),
			amountText: "40",
			title: "Dinner",
			categoryId: "food",
			withKeys: ["user:lucia1"],
		};
		const write = buildExpenseWrite(draft, input) as PendingWrite;
		const entry = {
			...waiting(write),
			payload: { ...write.body, splitMode: "PERCENTAGE" },
		};
		expect(canRestore(entry)).toBe(false);
		expect(restoreDraft(entry, { locale: "en-US", meId: "me1" })).toBeNull();
	});
});
