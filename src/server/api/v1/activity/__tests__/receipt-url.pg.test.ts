/**
 * A shared expense's receipt link (E2EE D11 revision 3, PR 6) on Postgres, in
 * both suites. The column is instance class: in the sealed suite the stored
 * cell is `\u0001k1:` ciphertext under the instance key, and in the plain
 * suite it is the link itself. Either way every reader gets the link back
 * whole: the editor who diffs it, the organizer who edits a guest's row, and
 * a viewer reading the audit history.
 *
 * Sofia (ARS home) adds ARS 12,000 split with Martin (ARS 6,000 each) with a
 * receipt link. Martin (editor) replaces it, Gus (guest contributor) adds an
 * expense of his own with one and Sofia replaces that. Vera is a viewer.
 */
import { createHash, randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sharedTransactionRouter } from "~/server/api/routers/shared-transaction";
import { createCallerFactory } from "~/server/api/trpc";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, sealedSuite } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { arsUser, seedRates, type TestUser } from "../../__tests__/g3-fixtures";
import { asMobile, call, expectBody } from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const SEALED = "\u0001k1:";
const createCaller = createCallerFactory(sharedTransactionRouter);

const FIRST = "https://recibos.example/cena-rosario.pdf";
const SECOND = "https://recibos.example/cena-rosario-final.pdf";
const GUEST_LINK = "https://recibos.example/taxi-gus.jpg";
const GUEST_EDITED = "https://recibos.example/taxi-gus-corregido.jpg";
const LEGACY = "https://recibos.example/legado.pdf";
const LEGACY_EDITED = "https://recibos.example/legado-nuevo.pdf";
const LINKS = [FIRST, SECOND, GUEST_LINK, GUEST_EDITED, LEGACY, LEGACY_EDITED];

type Changes = { receiptUrl?: unknown; amount?: unknown };
type Entry = { action: { type: string }; changes: Changes | null };

/** The two sides of an edit entry's receipt link. */
const sides = (changes: Changes | null | undefined) =>
	(changes?.receiptUrl ?? {}) as { old?: unknown; new?: unknown };
type History = { entries: Entry[] };

let sofia: TestUser;
let martin: TestUser;
let vera: TestUser;
let projectId: string;
let guestToken: string;
let guestId: string;
let asVera: Record<string, string>;

const asUser = (user: TestUser) =>
	createCaller({
		db: adminDb,
		session: makeSession({ id: user.user.id }),
		headers: new Headers(),
	});
const asGuest = () =>
	createCaller({
		db: adminDb,
		session: null,
		headers: new Headers({ "x-guest-token": guestToken }),
	});

const user = (u: TestUser): ParticipantRef => ({
	participantType: "user" as const,
	participantId: u.user.id,
});

const input = (
	amount: number,
	description: string,
	paidBy: ParticipantRef,
	splitWith: ParticipantRef[],
	receiptUrl?: string,
) => ({
	amount,
	currency: "ARS",
	description,
	date: new Date("2026-10-10T12:00:00Z"),
	paidBy,
	splitWith,
	splitMode: "EQUAL" as const,
	projectId,
	receiptUrl,
});

/** The cell as stored, read raw: nothing opens it. */
async function stored(id: string) {
	const [row] = await adminDb.$queryRaw<{ receiptUrl: string | null }[]>`
		SELECT "receiptUrl" FROM "shared_transaction" WHERE "id" = ${id}`;
	return row?.receiptUrl;
}

/** The cell through the app's own client, which opens it. */
async function opened(id: string) {
	return (
		await adminDb.sharedTransaction.findUniqueOrThrow({
			where: { id },
			select: { receiptUrl: true },
		})
	).receiptUrl;
}

/** The entries of a target, read raw. */
const entries = (targetId: string) =>
	adminDb.$queryRaw<
		{ action: string; changes: Changes; text: string }[]
	>`SELECT "action"::text AS "action", "changes", "changes"::text AS "text"
		FROM "audit_log_entry" WHERE "targetId" = ${targetId} ORDER BY "timestamp", "id"`;

/** A cell as stored: ciphertext in the sealed suite, the link itself otherwise. */
function atRest(value: unknown, link: string) {
	return sealedSuite
		? typeof value === "string" && value.startsWith(SEALED)
		: value === link;
}

const history = async (id: string, headers: Record<string, string>) =>
	(
		await expectBody<History>(
			await call(`/shared-expenses/${id}/history`, { headers }),
			contract.activity.history,
		)
	).entries;

beforeAll(async () => {
	await seedRates();
	[sofia, martin, vera] = [await arsUser(), await arsUser(), await arsUser()];
	asVera = await asMobile(vera.user.id);
	// Made on the database: the web's procedures take a cuid project id.
	projectId = (
		await adminDb.project.create({
			data: {
				name: "Viaje a Cuyo",
				primaryCurrency: "ARS",
				createdById: sofia.user.id,
			},
		})
	).id;
	for (const [member, role] of [
		[sofia, "ORGANIZER"],
		[martin, "EDITOR"],
		[vera, "VIEWER"],
	] as const)
		await adminDb.projectParticipant.create({
			data: {
				projectId,
				participantType: "user",
				participantId: member.user.id,
				role,
			},
		});
	const link = await adminDb.magicLink.create({
		data: {
			id: randomUUID(),
			projectId,
			roleGranted: "CONTRIBUTOR",
			createdById: sofia.user.id,
		},
	});
	guestToken = randomUUID();
	const gus = await adminDb.guestSession.create({
		data: {
			name: "Gus",
			email: `gus-${randomUUID()}@pg-test.invalid`,
			magicLinkId: link.id,
			projectId,
			sessionToken: createHash("sha256").update(guestToken).digest("hex"),
		},
	});
	guestId = gus.id;
	await adminDb.projectParticipant.create({
		data: {
			projectId,
			participantType: "guest",
			participantId: gus.id,
			role: "CONTRIBUTOR",
		},
	});
});

describe("a receipt link on a shared expense", () => {
	let expenseId: string;
	let firstCell: string | null | undefined;

	it("is stored sealed under the instance key (plain when sealing is off) and reads back", async () => {
		const created = await asUser(sofia).create(
			input(
				12000,
				"Cena en Rosario",
				user(sofia),
				[user(sofia), user(martin)],
				FIRST,
			),
		);
		expenseId = created.transaction.id;
		firstCell = await stored(expenseId);
		expect(atRest(firstCell, FIRST)).toBe(true);
		expect(await opened(expenseId)).toBe(FIRST);
		const shares = await adminDb.splitParticipant.findMany({
			where: { transactionId: expenseId },
			orderBy: { participantId: "asc" },
		});
		expect(shares.map((s) => s.shareAmount.toString()).sort()).toEqual([
			"6000",
			"6000",
		]);
	});

	it("is replaced by an editor who is not the author, and the diff holds the old link", async () => {
		await asUser(martin).update({ id: expenseId, receiptUrl: SECOND });
		const cell = await stored(expenseId);
		expect(atRest(cell, SECOND)).toBe(true);
		expect(await opened(expenseId)).toBe(SECOND);
		if (sealedSuite) expect(cell).not.toBe(firstCell);
		const edited = (await entries(expenseId)).find(
			(e) => e.action === "EDITED",
		);
		expect(atRest(sides(edited?.changes).old, FIRST)).toBe(true);
		expect(atRest(sides(edited?.changes).new, SECOND)).toBe(true);
	});

	it("keeps the link out of every stored audit entry when sealed, and the amounts plain", async () => {
		const rows = await entries(expenseId);
		expect(rows.map((r) => r.action)).toEqual(["CREATED", "EDITED"]);
		const [created] = rows;
		expect(atRest(created?.changes.receiptUrl, FIRST)).toBe(true);
		expect(created?.changes.amount).toBe(12000);
		for (const row of rows)
			for (const link of LINKS)
				expect(row.text.includes(link), `${row.action} ${link}`).toBe(
					!sealedSuite && row.text.includes(link),
				);
	});

	it("is read whole by an organizer, an editor and a viewer in the audit history", async () => {
		for (const headers of [
			asVera,
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
		]) {
			const trail = await history(expenseId, headers);
			const edited = trail.find((e) => e.action.type === "edited");
			expect(edited?.changes?.receiptUrl).toEqual({
				old: FIRST,
				new: SECOND,
			});
			expect(
				trail.find((e) => e.action.type === "created")?.changes?.receiptUrl,
			).toBe(FIRST);
			expect(JSON.stringify(trail)).not.toContain(SEALED);
		}
	});

	it("is not written again by an edit that leaves it alone", async () => {
		const before = await stored(expenseId);
		await asUser(sofia).update({ id: expenseId, description: "Cena" });
		expect(await stored(expenseId)).toBe(before);
		expect(await opened(expenseId)).toBe(SECOND);
	});

	it("is deleted with the expense, kept in the delete snapshot, and comes back sealed under the same id with the undo", async () => {
		const asSofia = await asMobile(sofia.user.id);
		const before = await stored(expenseId);
		const deleted = await expectBody<{ undo: string }>(
			await call(`/shared-expenses/${expenseId}`, {
				method: "DELETE",
				headers: asSofia,
				idempotent: true,
				body: { confirmUnsettled: true },
			}),
			contract["shared-expenses"].delete,
		);
		expect(await stored(expenseId)).toBeUndefined();
		const gone = (await entries(expenseId)).find((e) => e.action === "DELETED");
		expect(atRest(gone?.changes.receiptUrl, SECOND)).toBe(true);

		await expectBody(
			await call("/shared-expenses/undo", {
				method: "POST",
				headers: asSofia,
				idempotent: true,
				body: { token: deleted.undo },
			}),
			contract["shared-expenses"].undo,
		);
		const back = await stored(expenseId);
		expect(atRest(back, SECOND)).toBe(true);
		expect(await opened(expenseId)).toBe(SECOND);
		// A new seal of the same text is a new ciphertext (a fresh nonce).
		if (sealedSuite) expect(back).not.toBe(before);
		const trail = await history(expenseId, asVera);
		const snapshots = trail.filter(
			(e) => e.action.type === "deleted" || e.action.type === "created",
		);
		expect(snapshots.map((e) => e.changes?.receiptUrl).sort()).toEqual(
			[FIRST, SECOND, SECOND].sort(),
		);
	});

	it("is cleared by an editor and stays null, and the diff keeps the old link", async () => {
		await asUser(martin).update({ id: expenseId, receiptUrl: null });
		expect(await stored(expenseId)).toBeNull();
		expect(await opened(expenseId)).toBeNull();
		const cleared = (await entries(expenseId)).filter(
			(e) => e.action === "EDITED" && sides(e.changes).new === null,
		);
		expect(cleared).toHaveLength(1);
		expect(atRest(sides(cleared[0]?.changes).old, SECOND)).toBe(true);
	});
});

describe("a guest's receipt link", () => {
	it("is added by a guest contributor and replaced by the organizer", async () => {
		const gus = {
			participantType: "guest" as const,
			participantId: guestId,
		};
		const created = await asGuest().create(
			input(4500, "Taxi", gus, [gus, user(sofia)], GUEST_LINK),
		);
		const id = created.transaction.id;
		expect(atRest(await stored(id), GUEST_LINK)).toBe(true);
		expect(await opened(id)).toBe(GUEST_LINK);

		await asUser(sofia).update({ id, receiptUrl: GUEST_EDITED });
		expect(atRest(await stored(id), GUEST_EDITED)).toBe(true);
		expect(await opened(id)).toBe(GUEST_EDITED);
		const edited = (await entries(id)).find((e) => e.action === "EDITED");
		expect(atRest(sides(edited?.changes).old, GUEST_LINK)).toBe(true);
		expect(atRest(sides(edited?.changes).new, GUEST_EDITED)).toBe(true);
		const shares = await adminDb.splitParticipant.findMany({
			where: { transactionId: id },
		});
		expect(shares.map((s) => s.shareAmount.toString()).sort()).toEqual([
			"2250",
			"2250",
		]);
	});
});

describe("a link written before sealing", () => {
	it("reads as stored, and an edit seals the new link and keeps the old one readable in the diff", async () => {
		const created = await asUser(sofia).create(
			input(3000, "Helado", user(sofia), [user(sofia)], FIRST),
		);
		const id = created.transaction.id;
		// A row from before sealing: the link itself in the column.
		await adminDb.$executeRaw`UPDATE "shared_transaction" SET "receiptUrl" = ${LEGACY} WHERE "id" = ${id}`;
		expect(await opened(id)).toBe(LEGACY);

		await asUser(sofia).update({ id, receiptUrl: LEGACY_EDITED });
		expect(atRest(await stored(id), LEGACY_EDITED)).toBe(true);
		expect(await opened(id)).toBe(LEGACY_EDITED);
		const asSofia = await asMobile(sofia.user.id);
		const edited = (await history(id, asSofia)).find(
			(e) => e.action.type === "edited",
		);
		expect(edited?.changes?.receiptUrl).toEqual({
			old: LEGACY,
			new: LEGACY_EDITED,
		});
	});
});

describe("the input", () => {
	const make = (receiptUrl: string) =>
		asUser(sofia).create(
			input(1000, "Rechazado", user(sofia), [user(sofia)], receiptUrl),
		);

	it("refuses a text that is not a link, one that starts like a ciphertext, and one with a control character", async () => {
		const before = await adminDb.sharedTransaction.count({
			where: { projectId },
		});
		for (const bad of [
			"no es un enlace",
			`${SEALED}https://recibos.example/x`,
			"https://recibos.example/\u0007x",
			`https://recibos.example/${"a".repeat(2048)}`,
		])
			await expect(make(bad), bad.slice(0, 20)).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		expect(
			await adminDb.sharedTransaction.count({ where: { projectId } }),
		).toBe(before);
	});

	it("takes the longest link the limit allows", async () => {
		const link = `https://recibos.example/${"€".repeat(2048 - 24)}`;
		expect(link.length).toBe(2048);
		const created = await make(link);
		expect(atRest(await stored(created.transaction.id), link)).toBe(true);
		expect(await opened(created.transaction.id)).toBe(link);
	});
});
