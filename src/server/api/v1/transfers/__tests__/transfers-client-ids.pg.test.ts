/**
 * M6 PR2b: a transfer takes client-made ids for every row it creates (its
 * two TRANSFER legs, the fee's expense and FEE leg), so the device's row and
 * the server's meet by id at the pull-time compare. A given id lands on
 * exactly the row it names; a taken id (yours or another person's) is 409
 * id_taken and the whole move rolls back; absent ids behave as before.
 * ARS accounts at home currency, so no rate decides a value.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	arsUser,
	balanceOf,
	openAccount,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import {
	adminDb,
	asMobile,
	call,
	expectBody,
	expectProblem,
	fixtureDb,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.transfers;
type Write = {
	transfer: {
		id: string;
		legs: { from: string; to: string; fee: string | null };
		feeExpenseId: string | null;
	};
	undo: string;
};

const newIds = () => ({
	id: randomUUID(),
	fromLegId: randomUUID(),
	toLegId: randomUUID(),
	feeExpenseId: randomUUID(),
	feeLegId: randomUUID(),
});

describe("/api/v1/transfers client ids", () => {
	let userId: string;
	let otherId: string;
	let as: Record<string, string>;
	let asOther: Record<string, string>;
	let savings: string;
	let wallet: string;
	let theirs: string;
	let theirWallet: string;

	const post = (path: string, body: unknown, headers = as) =>
		call(path, { method: "POST", headers, body, idempotent: true });
	const move = (extra: Record<string, unknown> = {}) => ({
		fromAccountId: savings,
		toAccountId: wallet,
		fromAmount: "300",
		fee: { amount: "15" },
		...extra,
	});
	const create = async (body: unknown, headers = as) =>
		expectBody<Write>(await post("/transfers", body, headers), c.create, 201);
	/** Everything a move can leave behind, for the "nothing written" checks. */
	const counts = async () => ({
		transfers: await adminDb.transfer.count({
			where: { userId: { in: [userId, otherId] } },
		}),
		legs: await adminDb.accountLeg.count({
			where: { userId: { in: [userId, otherId] } },
		}),
		expenses: await adminDb.expense.count({
			where: { userId: { in: [userId, otherId] } },
		}),
		savings: await balanceOf(savings),
		wallet: await balanceOf(wallet),
		theirs: await balanceOf(theirs),
	});

	beforeAll(async () => {
		await seedArsRates();
		userId = (await arsUser()).user.id;
		otherId = (await arsUser()).user.id;
		as = { ...(await asMobile(userId)), "x-forwarded-for": "198.51.100.71" };
		asOther = {
			...(await asMobile(otherId)),
			"x-forwarded-for": "198.51.100.72",
		};
		savings = await openAccount(userId, "Savings", "CASH", "ARS", 50_000);
		wallet = await openAccount(userId, "Wallet", "CASH", "ARS", 10_000);
		theirs = await openAccount(otherId, "Theirs", "CASH", "ARS", 20_000);
		theirWallet = await openAccount(otherId, "Their wallet", "CASH", "ARS", 5);
	});

	it("given ids land on exactly the rows they name, and the answer carries them", async () => {
		const ids = newIds();
		const savingsBefore = Number(await balanceOf(savings));
		const walletBefore = Number(await balanceOf(wallet));
		const done = await create(move(ids));

		expect(done.transfer.id).toBe(ids.id);
		expect(done.transfer.legs).toEqual({
			from: ids.fromLegId,
			to: ids.toLegId,
			fee: ids.feeLegId,
		});
		expect(done.transfer.feeExpenseId).toBe(ids.feeExpenseId);

		const legs = await adminDb.accountLeg.findMany({
			where: { transferId: ids.id },
		});
		const byId = new Map(legs.map((l) => [l.id, l]));
		expect([...byId.keys()].sort()).toEqual(
			[ids.fromLegId, ids.toLegId, ids.feeLegId].sort(),
		);
		expect(byId.get(ids.fromLegId)).toMatchObject({
			accountId: savings,
			source: "TRANSFER",
		});
		expect(byId.get(ids.fromLegId)?.amount.toString()).toBe("-300");
		expect(byId.get(ids.toLegId)).toMatchObject({
			accountId: wallet,
			source: "TRANSFER",
		});
		expect(byId.get(ids.toLegId)?.amount.toString()).toBe("300");
		expect(byId.get(ids.feeLegId)).toMatchObject({
			accountId: savings,
			source: "FEE",
			expenseId: ids.feeExpenseId,
		});
		expect(byId.get(ids.feeLegId)?.amount.toString()).toBe("-15");
		const fee = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: ids.feeExpenseId },
		});
		expect(fee.amount.toString()).toBe("15");
		expect(
			(await fixtureDb.transfer.findUniqueOrThrow({ where: { id: ids.id } }))
				.feeExpenseId,
		).toBe(ids.feeExpenseId);
		// The ids change nothing about the money: 300 and the 15 fee leave Savings.
		expect(Number(await balanceOf(savings))).toBe(savingsBefore - 315);
		expect(Number(await balanceOf(wallet))).toBe(walletBefore + 300);
	});

	it("a fee id given for a move with no fee is unused, and absent ids book as before with the answer naming the rows", async () => {
		const ids = newIds();
		const unused = await create(move({ ...ids, fee: null }));
		expect(unused.transfer.legs).toEqual({
			from: ids.fromLegId,
			to: ids.toLegId,
			fee: null,
		});
		expect(unused.transfer.feeExpenseId).toBeNull();
		expect(
			await adminDb.accountLeg.count({ where: { id: ids.feeLegId } }),
		).toBe(0);
		expect(
			await fixtureDb.expense.count({ where: { id: ids.feeExpenseId } }),
		).toBe(0);

		const plain = await create(move());
		const legs = await adminDb.accountLeg.findMany({
			where: { transferId: plain.transfer.id },
		});
		expect(legs.map((l) => l.id).sort()).toEqual(
			[
				plain.transfer.legs.from,
				plain.transfer.legs.to,
				plain.transfer.legs.fee,
			].sort(),
		);
		expect(
			(
				await fixtureDb.transfer.findUniqueOrThrow({
					where: { id: plain.transfer.id },
				})
			).feeExpenseId,
		).toBe(plain.transfer.feeExpenseId);
	});

	describe("a taken id is 409 id_taken and books nothing", () => {
		let mine: Write["transfer"];
		let their: Write["transfer"];

		beforeAll(async () => {
			mine = (await create(move())).transfer;
			their = (
				await create(
					{
						fromAccountId: theirs,
						toAccountId: theirWallet,
						fromAmount: "40",
						fee: { amount: "4" },
					},
					asOther,
				)
			).transfer;
		});

		const taken = (owner: "yours" | "theirs") => {
			const t = owner === "yours" ? mine : their;
			return {
				id: t.id,
				fromLegId: t.legs.from,
				toLegId: t.legs.to,
				feeLegId: t.legs.fee ?? "",
				feeExpenseId: t.feeExpenseId ?? "",
			};
		};
		const cases = (["yours", "theirs"] as const).flatMap((owner) =>
			(["fromLegId", "toLegId", "feeLegId", "feeExpenseId", "id"] as const).map(
				(field) => [owner, field] as const,
			),
		);

		it.each(cases)("%s %s", async (owner, field) => {
			const before = await counts();
			// Every id fresh but the one under test, which is another row's.
			const body = move({ ...newIds(), [field]: taken(owner)[field] });
			await expectProblem(await post("/transfers", body), 409, "id_taken");
			expect(await counts()).toEqual(before);
			// The preview is the same write run and rolled back: it refuses too.
			await expectProblem(
				await post("/transfers/preview", body),
				409,
				"id_taken",
			);
			expect(await counts()).toEqual(before);
		});

		it("another person's row is never read: the answer is the same problem with nothing of theirs in it", async () => {
			const res = await post(
				"/transfers",
				move({ ...newIds(), fromLegId: their.legs.from }),
			);
			const text = await res.text();
			expect(res.status).toBe(409);
			expect(text).not.toContain(their.id);
			expect(text).not.toContain(theirs);
		});
	});

	it("a preview with ids writes nothing and does not use them up", async () => {
		const ids = newIds();
		const before = await counts();
		await expectBody(
			await post("/transfers/preview", move(ids)),
			c.previewCreate,
		);
		expect(await counts()).toEqual(before);
		for (const [table, id] of [
			["transfer", ids.id],
			["accountLeg", ids.fromLegId],
			["accountLeg", ids.toLegId],
			["accountLeg", ids.feeLegId],
			["expense", ids.feeExpenseId],
		] as const)
			expect(
				await (
					adminDb[table] as unknown as {
						count: (a: { where: { id: string } }) => Promise<number>;
					}
				).count({ where: { id } }),
			).toBe(0);
		// The same ids still write after the preview.
		const done = await create(move(ids));
		expect(done.transfer.id).toBe(ids.id);
	});

	it("the same Idempotency-Key replays the answer, with no second move and no id_taken", async () => {
		const ids = newIds();
		const key = randomUUID();
		const first = await call("/transfers", {
			method: "POST",
			headers: as,
			body: move(ids),
			idempotent: key,
		});
		const firstBody = await first.text();
		expect(first.status).toBe(201);
		const before = await counts();
		const again = await call("/transfers", {
			method: "POST",
			headers: as,
			body: move(ids),
			idempotent: key,
		});
		expect(again.status).toBe(201);
		expect(JSON.parse(await again.text())).toEqual(JSON.parse(firstBody));
		expect(await counts()).toEqual(before);
	});

	it("ids that are not uuids are refused before anything is written", async () => {
		const before = await counts();
		for (const field of [
			"fromLegId",
			"toLegId",
			"feeLegId",
			"feeExpenseId",
		] as const)
			await expectProblem(
				await post("/transfers", move({ [field]: "not-a-uuid" })),
				400,
				"validation_failed",
			);
		expect(await counts()).toEqual(before);
	});
});
