/**
 * The web's undo of a shared edit carries the stamp that edit left. A newer
 * edit makes the undo stale: it is refused on apply and on preview, the row
 * keeps the newer edit, and nobody is told. ARS home, an even split with Bob.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedArsRates } from "~/server/services/accounts/test-fixtures";
import { adminDb } from "~/test/pg-harness";
import { DAY, makeWorld, type World } from "./expense-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

beforeAll(seedArsRates);

let w: World;
beforeAll(async () => {
	w = await makeWorld();
});

const REFUSED = {
	code: "CONFLICT",
	message: "This expense changed since. Undo is no longer safe.",
};
const who = (id: string) => ({
	participantType: "user" as const,
	participantId: id,
});

/** The form the Add sheet sends for an edit of a shared expense. */
const form = (id: string, description: string, amount = "9000") => ({
	id,
	amount,
	currency: "ARS",
	description,
	date: DAY,
	notes: null,
	projectId: null,
	paidBy: who(w.userId),
	splitWith: [who(w.userId), who(w.otherId)],
	splitMode: "EQUAL" as const,
});

async function addShared(description: string) {
	const created = await w.callers.entry.shared.create.save({
		id: randomUUID(),
		amount: "9000",
		currency: "ARS",
		description,
		date: DAY,
		paidBy: who(w.userId),
		splitWith: [who(w.userId), who(w.otherId)],
		splitMode: "EQUAL",
	});
	return created.value.id;
}

const stored = (id: string) =>
	adminDb.sharedTransaction.findUniqueOrThrow({ where: { id } });

const undoOf = (saved: {
	value: { restore: object; updatedAt: string | null };
}) =>
	({
		...saved.value.restore,
		expectedUpdatedAt: saved.value.updatedAt,
	}) as never;

/** Everything a write could tell people with, for both of them. */
async function told() {
	const users = [w.userId, w.otherId];
	return {
		notifications: await adminDb.notification.count({
			where: { userId: { in: users } },
		}),
		events: await adminDb.apiEvent.count({ where: { userId: { in: users } } }),
		audit: await adminDb.eventLog.count({ where: { userId: { in: users } } }),
	};
}

/** Notices go out after commit, unawaited: let any that were sent land. */
const settle = () => new Promise((r) => setTimeout(r, 300));

describe("the web's revert of a shared edit", () => {
	it("is refused once a newer edit landed, changes nothing and tells no one", async () => {
		const { entry } = w.callers;
		const id = await addShared("Cena");
		const first = await entry.shared.update.save(form(id, "Cena B"));
		await entry.shared.update.save(form(id, "Cena C", "9500"));
		await settle();
		const before = await stored(id);
		const toldBefore = await told();

		await expect(entry.shared.revert.save(undoOf(first))).rejects.toMatchObject(
			REFUSED,
		);
		await expect(
			entry.shared.revert.preview(undoOf(first)),
		).rejects.toMatchObject(REFUSED);
		await settle();

		expect(await stored(id)).toEqual(before);
		expect(before.description).toBe("Cena C");
		expect(Number(before.amount)).toBe(9500);
		expect(await told()).toEqual(toldBefore);
	});

	it("puts the old values back for the latest edit, and its preview writes nothing", async () => {
		const { entry } = w.callers;
		const id = await addShared("Cena");
		const saved = await entry.shared.update.save(form(id, "Cena B", "9600"));
		const undo = undoOf(saved);

		const preview = await entry.shared.revert.preview(undo);
		expect(preview.value.id).toBe(id);
		expect((await stored(id)).description).toBe("Cena B");

		const done = await entry.shared.revert.save(undo);
		const back = await stored(id);
		expect(back.description).toBe("Cena");
		expect(Number(back.amount)).toBe(9000);
		// The undo leaves its own stamp, for a client that watches the row.
		expect(done.value.updatedAt).toBe(back.updatedAt.toISOString());
	});

	it("is not accepted without a stamp", async () => {
		const { entry } = w.callers;
		const id = await addShared("Cena");
		const saved = await entry.shared.update.save(form(id, "Cena B"));
		await expect(
			entry.shared.revert.save(saved.value.restore as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect((await stored(id)).description).toBe("Cena B");
	});

	it("the edit hands back the stamp the row now has", async () => {
		const id = await addShared("Cena");
		const saved = await w.callers.entry.shared.update.save(form(id, "Cena B"));
		expect(saved.value.updatedAt).toBe(
			(await stored(id)).updatedAt.toISOString(),
		);
	});
});
