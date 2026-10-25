/**
 * Reading one split expense, the shares others have not answered, accepting
 * many at once and taking yourself off a split, on Postgres through the
 * web's own procedures. Trip: Sofia (owner), Martin (editor), Lucia
 * (viewer); the project does not accept splits by itself, so the shares
 * wait. A stranger sees nothing.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	arsUser,
	seedProject,
	seedRates,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract["shared-expenses"];
type Detail = {
	id: string;
	title: string;
	amount: { minor: number };
	createdBy: { id: string; you: boolean };
	splits: { id: string; verification: string; share: { minor: number } }[];
	canEdit: boolean;
	canDelete: boolean;
	reason: string | null;
};

describe("shared expense reads and verification", () => {
	useApiV1();
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let stranger: TestUser;
	let asSofia: Record<string, string>;
	let asMartin: Record<string, string>;
	let asLucia: Record<string, string>;
	let asStranger: Record<string, string>;
	let trip: string;

	const send = (
		method: string,
		path: string,
		headers: Record<string, string>,
		body?: unknown,
	) => call(path, { method, headers, body, idempotent: true });

	async function addDinner(title = "Dinner") {
		const made = await send("POST", "/shared-expenses", asSofia, {
			amount: "900",
			currency: "ARS",
			description: title,
			date: "2026-10-10",
			paidBy: { type: "user", id: sofia.user.id },
			splitWith: [sofia, martin, lucia].map((u) => ({
				type: "user",
				id: u.user.id,
			})),
			splitMode: "EQUAL",
			projectId: trip,
		});
		return (await made.json()).id as string;
	}

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, lucia, stranger] = [
			await arsUser(),
			await arsUser(),
			await arsUser(),
			await arsUser(),
		];
		[asSofia, asMartin, asLucia, asStranger] = [
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
			await asMobile(lucia.user.id),
			await asMobile(stranger.user.id),
		];
		trip = await seedProject(sofia, [
			{ user: martin, role: "EDITOR" },
			{ user: lucia, role: "VIEWER" },
		]);
		await adminDb.project.update({
			where: { id: trip },
			data: { autoAcceptSplits: false },
		});
	});

	it("reads one split with its shares, who added it and what you may do", async () => {
		const id = await addDinner();
		const read = async (headers: Record<string, string>) =>
			expectBody<Detail>(
				await call(`/shared-expenses/${id}`, { headers }),
				c.get,
			);
		const asSofiaRead = await read(asSofia);
		expect(asSofiaRead).toMatchObject({
			title: "Dinner",
			amount: { minor: 90_000 },
			createdBy: { id: sofia.user.id, you: true },
			canEdit: true,
			canDelete: true,
			reason: null,
		});
		expect(asSofiaRead.splits.map((s) => s.share.minor)).toEqual([
			30_000, 30_000, 30_000,
		]);
		const martinRead = await read(asMartin);
		expect(martinRead.createdBy.you).toBe(false);
		expect(
			martinRead.splits.find((s) => s.id === martin.user.id)?.verification,
		).toBe("PENDING");
		// An editor may change it; a viewer may not, and is told why.
		expect(martinRead.canEdit).toBe(true);
		expect(await read(asLucia)).toMatchObject({
			canEdit: false,
			reason: "Viewers cannot edit or delete expenses",
		});
		await expectProblem(
			await call(`/shared-expenses/${id}`, { headers: asStranger }),
			404,
			"not_found",
		);
	});

	it("lists the shares others have not answered, by person", async () => {
		const id = await addDinner("Taxi");
		const out = await expectBody<{
			items: { id: string; expenses: { id: string; amount: { minor: number } }[] }[];
		}>(await call("/shared-expenses/outgoing", { headers: asSofia }), c.outgoing);
		const martinGroup = out.items.find((g) => g.id === martin.user.id);
		expect(martinGroup?.expenses.map((e) => e.id)).toContain(id);
		expect(martinGroup?.expenses[0]?.amount.minor).toBe(90_000);
		const none = await expectBody<{ items: unknown[] }>(
			await call("/shared-expenses/outgoing", { headers: asStranger }),
			c.outgoing,
		);
		expect(none.items).toEqual([]);
	});

	it("accepts many at once, skipping what is not yours or already answered", async () => {
		const a = await addDinner("A");
		const b = await addDinner("B");
		const mine = (id: string) =>
			adminDb.splitParticipant.findFirstOrThrow({
				where: { transactionId: id, participantId: martin.user.id },
			});
		const body = { ids: [a, b, randomUUID()] };
		const done = await expectBody<{ accepted: number }>(
			await send("POST", "/shared-expenses/accept", asMartin, body),
			c.bulkAccept,
		);
		expect(done.accepted).toBe(2);
		expect((await mine(a)).verificationStatus).toBe("ACCEPTED");
		const again = await expectBody<{ accepted: number }>(
			await send("POST", "/shared-expenses/accept", asMartin, body),
			c.bulkAccept,
		);
		expect(again.accepted).toBe(0);
		// Someone else's answer is theirs: Lucia's share is still waiting.
		expect(
			(
				await adminDb.splitParticipant.findFirstOrThrow({
					where: { transactionId: a, participantId: lucia.user.id },
				})
			).verificationStatus,
		).toBe("PENDING");
		await expectProblem(
			await send("POST", "/shared-expenses/accept", asMartin, { ids: [] }),
			400,
			"validation_failed",
		);
	});

	it("takes you off a split, but not the person who added it", async () => {
		const id = await addDinner("Snacks");
		await expectProblem(
			await send("POST", `/shared-expenses/${id}/remove-me`, asSofia, {}),
			403,
			"forbidden",
		);
		await expectProblem(
			await send("POST", `/shared-expenses/${id}/remove-me`, asStranger, {}),
			404,
			"not_found",
		);
		const rows = () =>
			adminDb.splitParticipant.findMany({ where: { transactionId: id } });
		// The preview shows what changes and writes nothing.
		const preview = await expectBody<{ changes: unknown[]; unchanged: unknown[] }>(
			await send("POST", `/shared-expenses/${id}/remove-me/preview`, asLucia, {}),
			c.previewRemoveMe,
		);
		expect(preview.changes.length + preview.unchanged.length).toBeGreaterThan(0);
		expect(await rows()).toHaveLength(3);

		const removed = await expectBody<{ id: string; undo: string }>(
			await send("POST", `/shared-expenses/${id}/remove-me`, asLucia, {}),
			c.removeMe,
		);
		expect((await rows()).map((s) => s.participantId).sort()).toEqual(
			[sofia.user.id, martin.user.id].sort(),
		);

		// Undo puts the share back exactly, once.
		const back = await expectBody<{ id: string; redo: string | null }>(
			await send("POST", "/shared-expenses/undo", asLucia, { token: removed.undo }),
			c.undo,
		);
		expect(back.id).toBe(id);
		const restored = (await rows()).find((s) => s.participantId === lucia.user.id);
		expect(restored).toMatchObject({ verificationStatus: "PENDING" });
		expect(Number(restored?.shareAmount)).toBe(300);
		await expectProblem(
			await send("POST", "/shared-expenses/undo", asLucia, { token: removed.undo }),
			409,
			"conflict",
		);

		// An edit after the removal makes its undo unsafe.
		const again = await expectBody<{ undo: string }>(
			await send("POST", `/shared-expenses/${id}/remove-me`, asLucia, {}),
			c.removeMe,
		);
		await adminDb.sharedTransaction.update({
			where: { id },
			data: { notes: "edited since" },
		});
		await expectProblem(
			await send("POST", "/shared-expenses/undo", asLucia, { token: again.undo }),
			409,
			"conflict",
		);
		expect(await rows()).toHaveLength(2);
	});
});
