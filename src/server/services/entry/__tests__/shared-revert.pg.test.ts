/**
 * The web's undo of a shared edit carries the stamp that edit left. A newer
 * edit (a split-only one too), or an answer from a person on it, makes the
 * undo refused on apply and on preview: the row keeps what it has and nothing
 * is queued to tell anyone. ARS home, a split with Bob.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedArsRates } from "~/server/services/accounts/test-fixtures";
import { revertSharedExpense } from "~/server/services/entry/guarded.mutation";
import { forUser } from "~/server/services/preview";
import { answerShareMutation } from "~/server/services/shared-expenses/answer-share.mutation";
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

/** Mine and Bob's shares of an EXACT split; omitted for an even one. */
type Shares = readonly [number, number];
const people = (shares?: Shares) => [
	{ ...who(w.userId), ...(shares ? { shareAmount: shares[0] } : {}) },
	{ ...who(w.otherId), ...(shares ? { shareAmount: shares[1] } : {}) },
];

/** The form the Add sheet sends for an edit of a shared expense. */
const form = (
	id: string,
	description: string,
	amount = "9000",
	shares?: Shares,
) => ({
	id,
	amount,
	currency: "ARS",
	description,
	date: DAY,
	notes: null,
	projectId: null,
	paidBy: who(w.userId),
	splitWith: people(shares),
	splitMode: shares ? ("EXACT" as const) : ("EQUAL" as const),
});

async function addShared(description: string, shares?: Shares) {
	const {
		id: _id,
		notes: _n,
		projectId: _p,
		...rest
	} = form("unused", description, "9000", shares);
	const created = await w.callers.entry.shared.create.save({
		...rest,
		id: randomUUID(),
	} as never);
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

describe("the web's revert of a shared edit", () => {
	it("is refused once a newer edit landed, changes nothing and queues no notice", async () => {
		const { entry } = w.callers;
		const id = await addShared("Cena");
		const first = await entry.shared.update.save(form(id, "Cena B"));
		await entry.shared.update.save(form(id, "Cena C", "9500"));
		const before = await stored(id);

		// The refusal throws before the write, so nothing is ever queued to send.
		const queued: (() => Promise<void>)[] = [];
		await expect(
			forUser(w.userId).apply(revertSharedExpense, {
				...(undoOf(first) as object),
				notify: queued,
			} as never),
		).rejects.toMatchObject(REFUSED);
		expect(queued).toEqual([]);
		await expect(entry.shared.revert.save(undoOf(first))).rejects.toMatchObject(
			REFUSED,
		);
		await expect(
			entry.shared.revert.preview(undoOf(first)),
		).rejects.toMatchObject(REFUSED);

		expect(await stored(id)).toEqual(before);
		expect(before.description).toBe("Cena C");
		expect(Number(before.amount)).toBe(9500);
	});

	it("queues the notice when the revert is allowed", async () => {
		// The control for the test above: the same call queues when it goes through.
		const id = await addShared("Cena");
		const saved = await w.callers.entry.shared.update.save(
			form(id, "Cena B", "9600"),
		);
		const queued: (() => Promise<void>)[] = [];
		await forUser(w.userId).apply(revertSharedExpense, {
			...(undoOf(saved) as object),
			notify: queued,
		} as never);
		expect(queued.length).toBeGreaterThan(0);
	});

	it("is refused after a split-only edit, which changes no column of the row itself", async () => {
		const { entry } = w.callers;
		const id = await addShared("Cena", [4000, 5000]);
		const first = await entry.shared.update.save(
			form(id, "Cena B", "9000", [4000, 5000]),
		);
		const stamped = await stored(id);
		await new Promise((r) => setTimeout(r, 20));
		await entry.shared.update.save(form(id, "Cena B", "9000", [3000, 6000]));

		const after = await stored(id);
		expect(after.updatedAt.getTime()).toBeGreaterThan(
			stamped.updatedAt.getTime(),
		);
		await expect(entry.shared.revert.save(undoOf(first))).rejects.toMatchObject(
			REFUSED,
		);
		await expect(
			entry.shared.revert.preview(undoOf(first)),
		).rejects.toMatchObject(REFUSED);
		const shares = await adminDb.splitParticipant.findMany({
			where: { transactionId: id },
			orderBy: { shareAmount: "asc" },
		});
		expect(shares.map((p) => Number(p.shareAmount))).toEqual([3000, 6000]);
	});

	it("is refused when it would change the amount after a person on it answered, and their answer stays", async () => {
		const { entry } = w.callers;
		const id = await addShared("Cena");
		const saved = await entry.shared.update.save(form(id, "Cena B", "9600"));
		// A project that asks for approval leaves Bob's share pending; a standalone
		// expense auto-accepts it, which is not an answer.
		await adminDb.splitParticipant.updateMany({
			where: { transactionId: id, participantId: w.otherId },
			data: { verificationStatus: "PENDING", verifiedAt: null },
		});
		// A project that asks for approval leaves Bob's share pending; a standalone
		// expense auto-accepts it, which is not an answer.
		await adminDb.splitParticipant.updateMany({
			where: { transactionId: id, participantId: w.otherId },
			data: { verificationStatus: "PENDING", verifiedAt: null },
		});
		await forUser(w.otherId).apply(answerShareMutation, {
			transactionId: id,
			answer: "accept",
		});
		const answered = await stored(id);
		const refusal = {
			code: "CONFLICT",
			message:
				"Someone already answered this expense, so this edit cannot be undone.",
		};

		await expect(entry.shared.revert.save(undoOf(saved))).rejects.toMatchObject(
			refusal,
		);
		await expect(
			entry.shared.revert.preview(undoOf(saved)),
		).rejects.toMatchObject(refusal);

		expect(await stored(id)).toEqual(answered);
		expect(answered.description).toBe("Cena B");
		const bob = await adminDb.splitParticipant.findFirstOrThrow({
			where: { transactionId: id, participantId: w.otherId },
		});
		expect(bob.verificationStatus).toBe("ACCEPTED");
	});

	const bobsStatus = async (id: string) =>
		(
			await adminDb.splitParticipant.findFirstOrThrow({
				where: { transactionId: id, participantId: w.otherId },
			})
		).verificationStatus;
	/** Bob's share waits for an answer (a project that asks), then he accepts. */
	async function bobAccepts(id: string) {
		await adminDb.splitParticipant.updateMany({
			where: { transactionId: id, participantId: w.otherId },
			data: { verificationStatus: "PENDING", verifiedAt: null },
		});
		await forUser(w.otherId).apply(answerShareMutation, {
			transactionId: id,
			answer: "accept",
		});
	}

	it("undoes a text-only edit after a person answered, and leaves their answer", async () => {
		const { entry } = w.callers;
		const id = await addShared("Cena");
		await bobAccepts(id);
		const saved = await entry.shared.update.save(form(id, "Cenaa typo"));
		expect(await bobsStatus(id)).toBe("ACCEPTED");

		await entry.shared.revert.preview(undoOf(saved));
		await entry.shared.revert.save(undoOf(saved));
		expect((await stored(id)).description).toBe("Cena");
		expect(await bobsStatus(id)).toBe("ACCEPTED");
	});

	it("undoes an amount edit nobody has answered yet", async () => {
		const { entry } = w.callers;
		const id = await addShared("Cena");
		const saved = await entry.shared.update.save(form(id, "Cena", "9600"));
		await entry.shared.revert.save(undoOf(saved));
		const back = await stored(id);
		expect(Number(back.amount)).toBe(9000);
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
