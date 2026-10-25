/**
 * /api/v1/shared-expenses on Postgres: add, edit and delete a split through
 * the web's own mutations, previews that equal the result, undo and redo,
 * idempotent replay, accept and reject, and who may touch what. Sofia adds
 * ARS 90 split equally with Martin, so Martin owes her ARS 45. Lucia is not
 * on it and gets a 404; Martin is on it but is not its creator, so he gets
 * what the web gives him: accept, reject, a 403 on edit and delete.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	ars,
	arsUser,
	seedRates,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import {
	asKey,
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract["shared-expenses"];
type Money = { minor: number; currency: string };
type Write = { id: string; backdatedPeriod: string | null; undo: string };
type Preview = {
	changes: { id: string; delta: Money }[];
	unchanged: { id: string }[];
};
type Verification = {
	id: string;
	status: string;
	participants: { id: string; status: string }[];
};

describe("/api/v1/shared-expenses", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let as: Record<string, string>;
	let asMartin: Record<string, string>;
	let asLucia: Record<string, string>;

	const post = (path: string, body: unknown, headers = as, key?: string) =>
		call(path, { method: "POST", headers, body, idempotent: key ?? true });
	const put = (path: string, body: unknown, headers = as) =>
		call(path, { method: "PUT", headers, body, idempotent: true });
	const del = (path: string, body: unknown = {}, headers = as) =>
		call(path, { method: "DELETE", headers, body, idempotent: true });

	const body = (over: Record<string, unknown> = {}) => ({
		amount: "90",
		currency: "ARS",
		description: "Dinner",
		date: "2026-10-10",
		paidBy: { type: "user", id: sofia.user.id },
		splitWith: [
			{ type: "user", id: sofia.user.id },
			{ type: "user", id: martin.user.id },
		],
		splitMode: "EQUAL",
		...over,
	});
	const add = async (over: Record<string, unknown> = {}) =>
		expectBody<Write>(
			await post("/shared-expenses", body(over)),
			c.create,
			201,
		);
	const owedToYou = async (headers = as) => {
		const list = await expectBody<{ owedToYou: Money | null }>(
			await call("/people", { headers }),
			contract.people.list,
		);
		return list.owedToYou?.minor ?? 0;
	};
	const row = (id: string) =>
		adminDb.sharedTransaction.findUnique({
			where: { id },
			include: { splitParticipants: true },
		});

	/** A split starts auto-accepted for a person on Retrospend; put it back to waiting. */
	const waiting = (id: string) =>
		adminDb.splitParticipant.updateMany({
			where: { transactionId: id, participantId: martin.user.id },
			data: { verificationStatus: "PENDING" },
		});

	beforeAll(async () => {
		await seedRates();
		sofia = await arsUser();
		martin = await arsUser();
		lucia = await arsUser();
		as = await asMobile(sofia.user.id);
		asMartin = await asMobile(martin.user.id);
		asLucia = await asMobile(lucia.user.id);
	});

	it("previews an add, then adds it with the same effect", async () => {
		const before = await owedToYou();
		const preview = await expectBody<Preview>(
			await post("/shared-expenses/preview", body()),
			c.previewCreate,
		);
		const owed = preview.changes.find((x) => x.id === "owed.owedToYou");
		expect(owed?.delta).toEqual(ars(4500));
		expect(await owedToYou()).toBe(before);
		await expect(
			adminDb.sharedTransaction.count({
				where: { createdById: sofia.user.id },
			}),
		).resolves.toBe(0);

		const written = await add({ description: "Dinner out" });
		expect(await owedToYou()).toBe(before + (owed?.delta.minor ?? 0));
		const saved = await row(written.id);
		expect(saved).toMatchObject({
			description: "Dinner out",
			currency: "ARS",
			paidById: sofia.user.id,
		});
		expect(Number(saved?.amount)).toBe(90);
		expect(
			saved?.splitParticipants
				.map((p) => [p.participantId, Number(p.shareAmount)])
				.sort(),
		).toEqual(
			[
				[martin.user.id, 45],
				[sofia.user.id, 45],
			].sort(),
		);
	});

	it("adds once per idempotency key and once per client id", async () => {
		const key = randomUUID();
		const id = randomUUID();
		const first = await post("/shared-expenses", body({ id }), as, key);
		const again = await post("/shared-expenses", body({ id }), as, key);
		expect(again.headers.get("idempotent-replayed")).toBe("true");
		expect(await again.json()).toEqual(await first.json());
		await expect(
			adminDb.sharedTransaction.count({ where: { id } }),
		).resolves.toBe(1);
		await expectProblem(
			await post("/shared-expenses", body({ id })),
			409,
			"id_taken",
		);
	});

	it("refuses money as a number and a share that does not add up", async () => {
		await expectProblem(
			await post("/shared-expenses", body({ amount: 90 })),
			400,
			"validation_failed",
		);
		await expectProblem(
			await post(
				"/shared-expenses",
				body({
					splitMode: "EXACT",
					splitWith: [
						{ type: "user", id: sofia.user.id, shareAmount: "10" },
						{ type: "user", id: martin.user.id, shareAmount: "10" },
					],
				}),
			),
			400,
			"bad_request",
		);
	});

	it("lets the other person accept or reject their share", async () => {
		const accepted = await add({ description: "To accept" });
		await waiting(accepted.id);
		const ok = await expectBody<Verification>(
			await post(`/shared-expenses/${accepted.id}/accept`, {}, asMartin),
			c.accept,
		);
		expect(ok.participants.find((p) => p.id === martin.user.id)?.status).toBe(
			"ACCEPTED",
		);
		const again = await post(
			`/shared-expenses/${accepted.id}/accept`,
			{},
			asMartin,
		);
		expect(again.status).toBe(200);

		const rejected = await add({ description: "To reject" });
		await waiting(rejected.id);
		const no = await expectBody<Verification>(
			await post(
				`/shared-expenses/${rejected.id}/reject`,
				{ reason: "Not mine" },
				asMartin,
			),
			c.reject,
		);
		expect(no.status).toBe("disputed");
		await expect(
			adminDb.splitParticipant.findFirst({
				where: { transactionId: rejected.id, participantId: martin.user.id },
			}),
		).resolves.toMatchObject({
			verificationStatus: "REJECTED",
			rejectionReason: "Not mine",
		});

		await expectProblem(
			await post(`/shared-expenses/${accepted.id}/accept`, {}, asLucia),
			404,
			"not_found",
		);
	});

	it("previews accepting and rejecting, and takes each back from its token", async () => {
		const made = await add({ description: "Answer me" });
		await waiting(made.id);
		const mine = async () =>
			(await row(made.id))?.splitParticipants.find(
				(p) => p.participantId === martin.user.id,
			);

		const was = await mine();
		const dry = await expectBody<Preview>(
			await post(`/shared-expenses/${made.id}/accept/preview`, {}, asMartin),
			c.previewAccept,
		);
		expect(dry.changes).toBeInstanceOf(Array);
		expect((await mine())?.verificationStatus).toBe("PENDING");

		const ok = await expectBody<Verification & { undo: string }>(
			await post(`/shared-expenses/${made.id}/accept`, {}, asMartin),
			c.accept,
		);
		expect((await mine())?.verificationStatus).toBe("ACCEPTED");
		await expectBody(
			await post("/shared-expenses/undo", { token: ok.undo }, asMartin),
			c.undo,
		);
		// Back exactly as it was, stamp included.
		expect(await mine()).toMatchObject({
			verificationStatus: "PENDING",
			verifiedAt: was?.verifiedAt,
		});
		// A token works once.
		await expectProblem(
			await post("/shared-expenses/undo", { token: ok.undo }, asMartin),
			409,
			"conflict",
		);

		await expectBody<Preview>(
			await post(
				`/shared-expenses/${made.id}/reject/preview`,
				{ reason: "Not mine" },
				asMartin,
			),
			c.previewReject,
		);
		expect((await mine())?.verificationStatus).toBe("PENDING");
		const no = await expectBody<Verification & { undo: string }>(
			await post(
				`/shared-expenses/${made.id}/reject`,
				{ reason: "Not mine" },
				asMartin,
			),
			c.reject,
		);
		expect(await mine()).toMatchObject({
			verificationStatus: "REJECTED",
			rejectionReason: "Not mine",
		});
		await expectBody(
			await post("/shared-expenses/undo", { token: no.undo }, asMartin),
			c.undo,
		);
		expect(await mine()).toMatchObject({
			verificationStatus: "PENDING",
			rejectionReason: null,
		});
	});

	it("refuses to take an answer back once the share changed again", async () => {
		const made = await add({ description: "Answered twice" });
		await waiting(made.id);
		const first = await expectBody<Verification & { undo: string }>(
			await post(`/shared-expenses/${made.id}/accept`, {}, asMartin),
			c.accept,
		);
		await post(`/shared-expenses/${made.id}/reject`, {}, asMartin);
		await expectProblem(
			await post("/shared-expenses/undo", { token: first.undo }, asMartin),
			409,
			"conflict",
		);
	});

	it("refuses to take an answer back once the expense is settled", async () => {
		const made = await add({ description: "Locked after answering" });
		await waiting(made.id);
		const answered = await expectBody<Verification & { undo: string }>(
			await post(`/shared-expenses/${made.id}/accept`, {}, asMartin),
			c.accept,
		);
		await adminDb.sharedTransaction.update({
			where: { id: made.id },
			data: { isLocked: true },
		});
		await expectProblem(
			await post("/shared-expenses/undo", { token: answered.undo }, asMartin),
			409,
			"conflict",
		);
		await expectProblem(
			await post(
				"/shared-expenses/undo/preview",
				{ token: answered.undo },
				asMartin,
			),
			409,
			"conflict",
		);
		// The share was left as answered.
		await expect(
			adminDb.splitParticipant.findFirst({
				where: { transactionId: made.id, participantId: martin.user.id },
			}),
		).resolves.toMatchObject({ verificationStatus: "ACCEPTED" });
	});

	it("refuses another person's undo token for an answer", async () => {
		const made = await add({ description: "Not yours to undo" });
		await waiting(made.id);
		const answered = await expectBody<Verification & { undo: string }>(
			await post(`/shared-expenses/${made.id}/reject`, {}, asMartin),
			c.reject,
		);
		for (const headers of [as, asLucia]) {
			await expectProblem(
				await post("/shared-expenses/undo", { token: answered.undo }, headers),
				400,
				"bad_request",
			);
		}
		await expect(
			adminDb.splitParticipant.findFirst({
				where: { transactionId: made.id, participantId: martin.user.id },
			}),
		).resolves.toMatchObject({ verificationStatus: "REJECTED" });
		// The owner can still take it back.
		await expectBody(
			await post("/shared-expenses/undo", { token: answered.undo }, asMartin),
			c.undo,
		);
	});

	it("gives a participant who is not the creator what the web gives", async () => {
		const made = await add({ description: "Sofia's" });
		const edit = {
			...body({ description: "Martin's edit", amount: "10" }),
			id: made.id,
		};
		await expectProblem(
			await put(`/shared-expenses/${made.id}`, edit, asMartin),
			403,
			"forbidden",
		);
		await expectProblem(
			await del(`/shared-expenses/${made.id}`, {}, asMartin),
			403,
			"forbidden",
		);
		expect((await row(made.id))?.description).toBe("Sofia's");
	});

	it("keeps a split to the people on it", async () => {
		const made = await add({ description: "Private" });
		const edit = { ...body({ description: "Lucia's edit" }), id: made.id };
		await expectProblem(
			await post(`/shared-expenses/${made.id}/preview`, edit, asLucia),
			404,
			"not_found",
		);
		await expectProblem(
			await put(`/shared-expenses/${made.id}`, edit, asLucia),
			404,
			"not_found",
		);
		await expectProblem(
			await del(`/shared-expenses/${made.id}`, {}, asLucia),
			404,
			"not_found",
		);
		await expectProblem(
			await post(`/shared-expenses/${made.id}/reject`, {}, asLucia),
			404,
			"not_found",
		);
		await expectProblem(
			await post("/shared-expenses/undo", { token: made.undo }, asLucia),
			400,
			"bad_request",
		);
		expect((await row(made.id))?.description).toBe("Private");
	});

	it("edits a split, previews it, and undoes and redoes the edit", async () => {
		const made = await add({ description: "Edit me" });
		const before = await owedToYou();
		const edit = {
			...body({ amount: "120", description: "Edited" }),
			id: made.id,
		};
		const preview = await expectBody<Preview>(
			await post(`/shared-expenses/${made.id}/preview`, edit),
			c.previewUpdate,
		);
		const delta = preview.changes.find((x) => x.id === "owed.owedToYou")?.delta;
		expect(delta).toEqual(ars(1500));
		expect((await row(made.id))?.description).toBe("Edit me");

		const edited = await expectBody<Write>(
			await put(`/shared-expenses/${made.id}`, edit),
			c.update,
		);
		expect(await owedToYou()).toBe(before + 1500);
		expect(Number((await row(made.id))?.amount)).toBe(120);

		const undone = await expectBody<{ id: string; redo: string | null }>(
			await post("/shared-expenses/undo", { token: edited.undo }),
			c.undo,
		);
		expect(Number((await row(made.id))?.amount)).toBe(90);
		expect((await row(made.id))?.description).toBe("Edit me");
		expect(await owedToYou()).toBe(before);

		await expectBody(
			await post("/shared-expenses/undo", { token: undone.redo }),
			c.undo,
		);
		expect(Number((await row(made.id))?.amount)).toBe(120);
	});

	it("takes an add back and tells nobody, with a preview that matches", async () => {
		const before = await owedToYou();
		const made = await add({ description: "Oops" });
		expect(await owedToYou()).toBe(before + 4500);
		const preview = await expectBody<Preview>(
			await post("/shared-expenses/undo/preview", { token: made.undo }),
			c.previewUndo,
		);
		expect(
			preview.changes.find((x) => x.id === "owed.owedToYou")?.delta,
		).toEqual(ars(-4500));
		expect(await row(made.id)).not.toBeNull();
		const undone = await expectBody<{ redo: string | null }>(
			await post("/shared-expenses/undo", { token: made.undo }),
			c.undo,
		);
		expect(undone.redo).toBeNull();
		expect(await row(made.id)).toBeNull();
		expect(await owedToYou()).toBe(before);
	});

	it("asks to confirm a delete that erases a debt, and previews both ways", async () => {
		const made = await add({ description: "Delete me" });
		const before = await owedToYou();
		const path = `/shared-expenses/${made.id}`;
		await expectProblem(await del(path), 409, "conflict");
		await expectProblem(
			await post(`${path}/delete/preview`, {}),
			409,
			"conflict",
		);
		expect(await row(made.id)).not.toBeNull();

		const preview = await expectBody<Preview>(
			await post(`${path}/delete/preview`, { confirmUnsettled: true }),
			c.previewDelete,
		);
		expect(
			preview.changes.find((x) => x.id === "owed.owedToYou")?.delta,
		).toEqual(ars(-4500));
		expect(await row(made.id)).not.toBeNull();

		const deleted = await expectBody<{ id: string }>(
			await del(path, { confirmUnsettled: true }),
			c.delete,
		);
		expect(deleted.id).toBe(made.id);
		expect(await row(made.id)).toBeNull();
		expect(await owedToYou()).toBe(before - 4500);
	});

	it("refuses an undo that would wipe a newer edit, and spends a token once", async () => {
		const made = await add({ description: "Dinner" });
		const edit = (amount: string, description: string) => ({
			...body({ amount, description }),
			id: made.id,
		});
		const first = await expectBody<Write>(
			await put(`/shared-expenses/${made.id}`, edit("120", "Edited")),
			c.update,
		);
		const latest = await expectBody<Write>(
			await put(`/shared-expenses/${made.id}`, edit("150", "Latest")),
			c.update,
		);
		// The first edit's undo would restore 90 "Dinner" over the newer edit.
		await expectProblem(
			await post("/shared-expenses/undo", { token: first.undo }),
			409,
			"conflict",
		);
		await expectProblem(
			await post("/shared-expenses/undo/preview", { token: first.undo }),
			409,
			"conflict",
		);
		expect(Number((await row(made.id))?.amount)).toBe(150);
		expect((await row(made.id))?.description).toBe("Latest");

		// The latest edit's undo works once; the same token again does not.
		const before = await owedToYou();
		await expectBody(
			await post("/shared-expenses/undo", { token: latest.undo }),
			c.undo,
		);
		expect(Number((await row(made.id))?.amount)).toBe(120);
		const after = await owedToYou();
		await expectProblem(
			await post("/shared-expenses/undo", { token: latest.undo }),
			409,
			"conflict",
		);
		expect(await owedToYou()).toBe(after);
		expect(after).toBe(before - 1500);
	});

	it("refuses more decimals than the currency has, and amounts a float cannot hold", async () => {
		const usd = (over: Record<string, unknown>) =>
			post("/shared-expenses", body({ currency: "USD", ...over }));
		await expectProblem(await usd({ amount: "10.005" }), 400, "bad_request");
		await expectProblem(
			await post("/shared-expenses", body({ amount: "1234567890.12345678" })),
			400,
			"bad_request",
		);
		await expectProblem(
			await usd({
				amount: "10",
				splitMode: "EXACT",
				splitWith: [
					{ type: "user", id: sofia.user.id, shareAmount: "5.005" },
					{ type: "user", id: martin.user.id, shareAmount: "4.995" },
				],
			}),
			400,
			"bad_request",
		);
		await expectProblem(
			await put(`/shared-expenses/x`, {
				...body({ currency: "USD", amount: "0.001" }),
				id: "x",
			}),
			400,
			"bad_request",
		);
		// What the currency has is stored exactly.
		const ok = await expectBody<Write>(
			await usd({ amount: "10.01" }),
			c.create,
			201,
		);
		expect(Number((await row(ok.id))?.amount)).toBe(10.01);
		const exact = await expectBody<Write>(
			await post("/shared-expenses", body({ amount: "1234567890.12" })),
			c.create,
			201,
		);
		expect((await row(exact.id))?.amount.toString()).toBe("1234567890.12");
	});

	it("will not retract an add that someone already answered", async () => {
		const made = await add({ description: "Answered" });
		await waiting(made.id);
		await expectBody(
			await post(`/shared-expenses/${made.id}/accept`, {}, asMartin),
			c.accept,
		);
		await expectProblem(
			await post("/shared-expenses/undo", { token: made.undo }),
			409,
			"conflict",
		);
		expect(await row(made.id)).not.toBeNull();
	});

	it("needs write:expenses to write", async () => {
		const readOnly = await asKey(sofia.user.id, ["read"]);
		await expectProblem(
			await post("/shared-expenses", body(), readOnly),
			403,
			"missing_scope",
		);
	});
});
