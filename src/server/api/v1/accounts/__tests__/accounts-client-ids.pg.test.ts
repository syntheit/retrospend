/**
 * M6 PR2b: the account writes that create rows take client-made ids for them,
 * so the device's row and the server's meet by id at the pull-time compare:
 * Update balance (the Not logged leg, the rate switch), the rate type switch,
 * and Replace (PUT, which writes the same two rows). Account create writes no
 * leg and no switch, only its snapshot, which is keyed by (account, day). A
 * given id lands on exactly the row it names; a taken id (yours or another
 * person's) is 409 id_taken and the whole write rolls back; absent ids behave
 * as before. USD home, so every value is worked out by hand.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import {
	call,
	expectBody,
	expectProblem,
	asMobile as sessionHeaders,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.accounts;
type Write = { result: Record<string, unknown>; undo: string | null };

describe("account client ids", () => {
	let as: Record<string, string>;
	let asOther: Record<string, string>;
	let userId: string;
	let otherId: string;

	const send = (method: string, path: string, body?: unknown, headers = as) =>
		call(path, { method, headers, body, idempotent: true });
	const open = async (headers = as, over: Record<string, unknown> = {}) => {
		const body = {
			id: randomUUID(),
			name: "Wise",
			type: "CASH",
			currency: "USD",
			balance: "1000",
			...over,
		};
		await expectBody(
			await send("POST", "/accounts", body, headers),
			c.create,
			201,
		);
		return body;
	};
	const row = (id: string) =>
		fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } });
	/** What a write can leave behind on one account. */
	const state = async (id: string) => ({
		account: await row(id),
		legs: await adminDb.accountLeg.count({ where: { accountId: id } }),
		switches: await adminDb.assetRateType.count({ where: { accountId: id } }),
	});
	const balance = (id: string, body: Record<string, unknown>) =>
		send("POST", `/accounts/${id}/balance`, { id, ...body });

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		otherId = (await createTestUser()).user.id;
		as = {
			...(await sessionHeaders(userId)),
			"x-forwarded-for": "198.51.100.81",
		};
		asOther = {
			...(await sessionHeaders(otherId)),
			"x-forwarded-for": "198.51.100.82",
		};
	});

	describe("update balance", () => {
		it("the given ids land on the Not logged leg and the rate switch, and the answer names them", async () => {
			const a = await open();
			const legId = randomUUID();
			const rateTypeId = randomUUID();
			const done = await expectBody<Write>(
				await balance(a.id, {
					balance: "1200",
					rateType: "blue",
					legId,
					rateTypeId,
				}),
				c.updateBalance,
			);
			expect(done.result).toMatchObject({
				legId,
				rateSwitch: { rateTypeId, rateType: "blue" },
			});
			const leg = await adminDb.accountLeg.findUniqueOrThrow({
				where: { id: legId },
			});
			expect(leg).toMatchObject({
				accountId: a.id,
				source: "BALANCE_UPDATE",
			});
			expect(leg.amount.toString()).toBe("200");
			expect(
				await adminDb.assetRateType.findUniqueOrThrow({
					where: { id: rateTypeId },
				}),
			).toMatchObject({ accountId: a.id, type: "blue" });
			expect((await row(a.id)).balance.toString()).toBe("1200");
		});

		it("an id for a row that is not written is unused: no change in balance, no change in type", async () => {
			const a = await open();
			const legId = randomUUID();
			const rateTypeId = randomUUID();
			const done = await expectBody<Write>(
				await balance(a.id, { balance: "1000", legId, rateTypeId }),
				c.updateBalance,
			);
			expect(done.result).toMatchObject({ legId: null, rateSwitch: null });
			expect(await adminDb.accountLeg.count({ where: { id: legId } })).toBe(0);
			expect(
				await adminDb.assetRateType.count({ where: { id: rateTypeId } }),
			).toBe(0);
		});

		it("absent ids book as before, with the answer naming the rows", async () => {
			const a = await open();
			const done = await expectBody<Write>(
				await balance(a.id, { balance: "1300", rateType: "official" }),
				c.updateBalance,
			);
			const legId = done.result.legId as string;
			const switchId = (done.result.rateSwitch as { rateTypeId: string })
				.rateTypeId;
			expect(
				(
					await adminDb.accountLeg.findUniqueOrThrow({ where: { id: legId } })
				).amount.toString(),
			).toBe("300");
			expect(
				(
					await adminDb.assetRateType.findUniqueOrThrow({
						where: { id: switchId },
					})
				).type,
			).toBe("official");
		});

		describe("a taken id is 409 id_taken and writes nothing", () => {
			let mine: { legId: string; rateTypeId: string };
			let theirs: { legId: string; rateTypeId: string };

			// Client-made ids: only a uuid can be sent back as a taken one.
			const seed = async (headers: Record<string, string>) => {
				const acct = await open(headers);
				const ids = { legId: randomUUID(), rateTypeId: randomUUID() };
				await expectBody(
					await send(
						"POST",
						`/accounts/${acct.id}/balance`,
						{ id: acct.id, balance: "1100", rateType: "blue", ...ids },
						headers,
					),
					c.updateBalance,
				);
				return ids;
			};
			beforeAll(async () => {
				mine = await seed(as);
				theirs = await seed(asOther);
			});

			const cases = (["yours", "theirs"] as const).flatMap((owner) =>
				(["legId", "rateTypeId"] as const).map(
					(field) => [owner, field] as const,
				),
			);
			it.each(cases)("%s %s", async (owner, field) => {
				const a = await open();
				const before = await state(a.id);
				const taken = (owner === "yours" ? mine : theirs)[field];
				// Both rows are written (a new balance and a new type); only one id is taken.
				const body = {
					balance: "1500",
					rateType: "blue",
					legId: randomUUID(),
					rateTypeId: randomUUID(),
					[field]: taken,
				};
				await expectProblem(await balance(a.id, body), 409, "id_taken");
				expect(await state(a.id)).toEqual(before);
				await expectProblem(
					await send("POST", `/accounts/${a.id}/balance/preview`, {
						id: a.id,
						...body,
					}),
					409,
					"id_taken",
				);
				expect(await state(a.id)).toEqual(before);
			});
		});

		it("a preview with ids writes nothing and does not use them up", async () => {
			const a = await open();
			const body = {
				balance: "1400",
				rateType: "blue",
				legId: randomUUID(),
				rateTypeId: randomUUID(),
			};
			const before = await state(a.id);
			await expectBody(
				await send("POST", `/accounts/${a.id}/balance/preview`, {
					id: a.id,
					...body,
				}),
				c.previewUpdateBalance,
			);
			expect(await state(a.id)).toEqual(before);
			const done = await expectBody<Write>(
				await balance(a.id, body),
				c.updateBalance,
			);
			expect(done.result.legId).toBe(body.legId);
		});

		it("the same Idempotency-Key replays the answer, with no second leg and no id_taken", async () => {
			const a = await open();
			const body = {
				id: a.id,
				balance: "1250",
				legId: randomUUID(),
			};
			const key = randomUUID();
			const send1 = () =>
				call(`/accounts/${a.id}/balance`, {
					method: "POST",
					headers: as,
					body,
					idempotent: key,
				});
			const first = await send1();
			const firstBody = await first.text();
			expect(first.status).toBe(200);
			const before = await state(a.id);
			const again = await send1();
			expect(again.status).toBe(200);
			expect(JSON.parse(await again.text())).toEqual(JSON.parse(firstBody));
			expect(await state(a.id)).toEqual(before);
		});

		it("ids that are not uuids are refused", async () => {
			const a = await open();
			const before = await state(a.id);
			for (const field of ["legId", "rateTypeId"])
				await expectProblem(
					await balance(a.id, { balance: "1300", [field]: "nope" }),
					400,
					"validation_failed",
				);
			expect(await state(a.id)).toEqual(before);
		});
	});

	describe("rate type", () => {
		it("the given id lands on the switch row, and a taken id (yours or theirs) is 409 with the type unchanged", async () => {
			const a = await open();
			const rateTypeId = randomUUID();
			const done = await expectBody<Write>(
				await send("POST", `/accounts/${a.id}/rate-type`, {
					id: a.id,
					rateType: "blue",
					rateTypeId,
				}),
				c.setRateType,
			);
			expect(done.result.rateTypeId).toBe(rateTypeId);
			expect(
				await adminDb.assetRateType.findUniqueOrThrow({
					where: { id: rateTypeId },
				}),
			).toMatchObject({ accountId: a.id, type: "blue" });

			const theirAccount = await open(asOther);
			const theirSwitch = randomUUID();
			await expectBody(
				await send(
					"POST",
					`/accounts/${theirAccount.id}/rate-type`,
					{ id: theirAccount.id, rateType: "blue", rateTypeId: theirSwitch },
					asOther,
				),
				c.setRateType,
			);

			const b = await open();
			const before = await state(b.id);
			for (const taken of [rateTypeId, theirSwitch]) {
				const body = { id: b.id, rateType: "official", rateTypeId: taken };
				await expectProblem(
					await send("POST", `/accounts/${b.id}/rate-type`, body),
					409,
					"id_taken",
				);
				await expectProblem(
					await send("POST", `/accounts/${b.id}/rate-type/preview`, body),
					409,
					"id_taken",
				);
				expect(await state(b.id)).toEqual(before);
			}
		});

		it("absent id books as before, and a preview with an id writes nothing", async () => {
			const a = await open();
			const id = randomUUID();
			const before = await state(a.id);
			await expectBody(
				await send("POST", `/accounts/${a.id}/rate-type/preview`, {
					id: a.id,
					rateType: "blue",
					rateTypeId: id,
				}),
				c.previewSetRateType,
			);
			expect(await state(a.id)).toEqual(before);
			expect(await adminDb.assetRateType.count({ where: { id } })).toBe(0);
			const plain = await expectBody<Write>(
				await send("POST", `/accounts/${a.id}/rate-type`, {
					id: a.id,
					rateType: "blue",
				}),
				c.setRateType,
			);
			expect(
				await adminDb.assetRateType.count({
					where: { id: plain.result.rateTypeId as string },
				}),
			).toBe(1);
		});
	});

	describe("replace (PUT)", () => {
		it("the given ids land on the checkpoint leg and the switch it writes; a taken one is 409 and rolls both back", async () => {
			const a = await open();
			const legId = randomUUID();
			const rateTypeId = randomUUID();
			const written = await expectBody<Write>(
				await send("PUT", `/accounts/${a.id}`, {
					...a,
					balance: "1150",
					rateType: "blue",
					legId,
					rateTypeId,
				}),
				c.update,
			);
			// The answer says which of the ids it used.
			expect(written.result).toMatchObject({ legId, rateTypeId });
			expect(
				(
					await adminDb.accountLeg.findUniqueOrThrow({ where: { id: legId } })
				).amount.toString(),
			).toBe("150");
			expect(
				(
					await adminDb.assetRateType.findUniqueOrThrow({
						where: { id: rateTypeId },
					})
				).accountId,
			).toBe(a.id);

			const b = await open();
			const before = await state(b.id);
			const body = {
				...b,
				name: "Renamed",
				balance: "1150",
				rateType: "blue",
				legId: randomUUID(),
				rateTypeId,
			};
			await expectProblem(
				await send("PUT", `/accounts/${b.id}`, body),
				409,
				"id_taken",
			);
			expect(await state(b.id)).toEqual(before);
		});
	});

	describe("what PUT answers about the ids it was given", () => {
		it("null for a row it did not write: no change in balance, no change in type", async () => {
			const a = await open();
			const done = await expectBody<Write>(
				await send("PUT", `/accounts/${a.id}`, {
					...a,
					name: "Renamed",
					legId: randomUUID(),
					rateTypeId: randomUUID(),
				}),
				c.update,
			);
			expect(done.result).toMatchObject({ legId: null, rateTypeId: null });
		});

		it("only the leg when the balance changed and the type did not", async () => {
			const a = await open();
			const legId = randomUUID();
			const done = await expectBody<Write>(
				await send("PUT", `/accounts/${a.id}`, {
					...a,
					balance: "1200",
					legId,
					rateTypeId: randomUUID(),
				}),
				c.update,
			);
			expect(done.result).toMatchObject({ legId, rateTypeId: null });
		});

		it("null when no ids were sent, though a leg was written", async () => {
			const a = await open();
			const done = await expectBody<Write>(
				await send("PUT", `/accounts/${a.id}`, { ...a, balance: "1300" }),
				c.update,
			);
			expect(done.result).toMatchObject({ legId: null, rateTypeId: null });
		});
	});

	it("an account create with a taken id (another person's account) is 409 and writes nothing", async () => {
		const theirs = await open(asOther);
		const body = { ...theirs, id: theirs.id, name: "Mine" };
		await expectProblem(await send("POST", "/accounts", body), 409, "id_taken");
		expect(
			await adminDb.assetSnapshot.count({
				where: { accountId: theirs.id, userId },
			}),
		).toBe(0);
		expect(
			(
				await adminDb.assetAccount.findUniqueOrThrow({
					where: { id: theirs.id },
				})
			).userId,
		).toBe(otherId);
	});
});
