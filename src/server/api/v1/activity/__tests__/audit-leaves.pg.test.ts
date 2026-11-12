/**
 * The text leaves of the audit log (E2EE D11 PR 8.3) on Postgres, in both
 * suites. A shared expense's life (add, edit, dispute, delete, undo), a project
 * rename and a period relabel are read back whole by an organizer, a viewer and
 * a guest, through the web's procedures and the v1 feed and history. In the
 * sealed suite the entries are stored with sealed leaves under the instance
 * key (`\u0001k1:`), each bound to its own entry and path, the text nowhere in
 * the row, while the ids, codes and amounts that SQL reads stay plain.
 *
 * Sofia (ARS home) adds ARS 12,000 split with Martin (ARS 6,000 each), raises
 * it to ARS 15,000 (ARS 7,500 each), Martin disputes it, Sofia deletes it and
 * undoes the delete. Vera is a viewer; Gus is a guest contributor.
 */
import { createHash, randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { auditLogRouter } from "~/server/api/routers/audit-log";
import { createCallerFactory } from "~/server/api/trpc";
import { openField } from "~/server/crypto/field-crypto";
import { instanceTextKeys } from "~/server/db";
import { destroyDataKeys } from "~/server/services/keys/data-key.service";
import { adminDb, sealedSuite } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { arsUser, seedRates, type TestUser } from "../../__tests__/g3-fixtures";
import { asMobile, call, expectBody } from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const SEALED = "\u0001k1:";
const createAuditCaller = createCallerFactory(auditLogRouter);

const FIRST = "Cena en Rosario";
const SECOND = "Cena en Mendoza";
const NOTE_1 = "Con propina";
const NOTE_2 = "Sin propina";
const REASON = "No estuve en esa cena";
const TEXTS = [FIRST, SECOND, NOTE_1, NOTE_2, REASON];

type Entry = {
	id: string;
	action: { type: string };
	changes: Record<string, any> | null;
};
type Page = { items: Entry[] };
type History = { entries: Entry[] };

let sofia: TestUser;
let martin: TestUser;
let vera: TestUser;
let asSofia: Record<string, string>;
let asMartin: Record<string, string>;
let asVera: Record<string, string>;
let projectId: string;
let expenseId: string;
let guestToken: string;

const send = (
	method: string,
	path: string,
	headers: Record<string, string>,
	body?: unknown,
) => call(path, { method, headers, body, idempotent: true });

const owner = (id: string) =>
	createAuditCaller({
		db: adminDb,
		session: makeSession({ id }),
		headers: new Headers(),
	});
const guest = () =>
	createAuditCaller({
		db: adminDb,
		session: null,
		headers: new Headers({ "x-guest-token": guestToken }),
	});

/** The stored entries of a target, read raw: nothing opens them. */
async function stored(targetId: string) {
	return adminDb.$queryRaw<
		{
			id: string;
			action: string;
			changes: Record<string, any>;
			text: string;
		}[]
	>`SELECT "id", "action"::text AS "action", "changes", "changes"::text AS "text"
		FROM "audit_log_entry" WHERE "targetId" = ${targetId} ORDER BY "timestamp", "id"`;
}

const sealedLeaf = (value: unknown) =>
	typeof value === "string" && value.startsWith(SEALED);

/** A leaf as stored: ciphertext in the sealed suite, the text itself otherwise. */
const leaf = (value: unknown, text: string) =>
	sealedSuite ? sealedLeaf(value) : value === text;

const feed = async (headers: Record<string, string>) =>
	(
		await expectBody<Page>(
			await call(`/projects/${projectId}/activity?limit=100`, { headers }),
			contract.activity.feed,
		)
	).items;
const history = async (headers: Record<string, string>) =>
	(
		await expectBody<History>(
			await call(`/shared-expenses/${expenseId}/history`, { headers }),
			contract.activity.history,
		)
	).entries;
const only = (entries: Entry[], type: string) => {
	const found = entries.filter((e) => e.action.type === type);
	expect(found, type).toHaveLength(1);
	return found[0] as Entry;
};

beforeAll(async () => {
	await seedRates();
	[sofia, martin, vera] = [await arsUser(), await arsUser(), await arsUser()];
	[asSofia, asMartin, asVera] = [
		await asMobile(sofia.user.id),
		await asMobile(martin.user.id),
		await asMobile(vera.user.id),
	];
	projectId = (
		await (
			await send("POST", "/projects", asSofia, {
				id: randomUUID(),
				name: "Viaje a Cuyo",
				primaryCurrency: "ARS",
				billingCycleLength: "MONTHLY",
			})
		).json()
	).id;
	for (const [user, role] of [
		[martin, "EDITOR"],
		[vera, "VIEWER"],
	] as const)
		await send("POST", `/projects/${projectId}/members`, asSofia, {
			person: { type: "user", id: user.user.id },
			role,
		});
	// A guest contributor, as a magic link makes one.
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
	await adminDb.projectParticipant.create({
		data: {
			projectId,
			participantType: "guest",
			participantId: gus.id,
			role: "CONTRIBUTOR",
		},
	});

	// The expense's life.
	const body = (amount: string, description: string, notes: string) => ({
		amount,
		currency: "ARS",
		description,
		notes,
		date: "2026-10-10",
		paidBy: { type: "user", id: sofia.user.id },
		splitWith: [
			{ type: "user", id: sofia.user.id },
			{ type: "user", id: martin.user.id },
		],
		splitMode: "EQUAL",
		projectId,
	});
	expenseId = (
		await (
			await send(
				"POST",
				"/shared-expenses",
				asSofia,
				body("12000", FIRST, NOTE_1),
			)
		).json()
	).id;
	await send("PUT", `/shared-expenses/${expenseId}`, asSofia, {
		id: expenseId,
		...body("15000", SECOND, NOTE_2),
	});
	await send("POST", `/shared-expenses/${expenseId}/reject`, asMartin, {
		id: expenseId,
		reason: REASON,
	});
	const deleted = await expectBody<{ undo: string }>(
		await send("DELETE", `/shared-expenses/${expenseId}`, asSofia, {
			confirmUnsettled: true,
		}),
		contract["shared-expenses"].delete,
	);
	await expectBody(
		await send("POST", "/shared-expenses/undo", asSofia, {
			token: deleted.undo,
		}),
		contract["shared-expenses"].undo,
	);
});

describe("an expense's entries at rest", () => {
	it("keep every text leaf of the snapshot, the diff and the dispute sealed, and the rest plain", async () => {
		const rows = await stored(expenseId);
		expect(rows.map((r) => r.action)).toEqual([
			"CREATED",
			"EDITED",
			"REJECTED",
			"DELETED",
			"CREATED",
		]);
		const [created, edited, rejected, deleted, restored] = rows.map(
			(r) => r.changes,
		) as Record<string, any>[];

		expect(leaf(created?.description, FIRST)).toBe(true);
		expect(leaf(created?.notes, NOTE_1)).toBe(true);
		expect(created?.amount).toBe(12000);
		expect(created?.splitParticipants.map((s: any) => s.shareAmount)).toEqual([
			6000, 6000,
		]);

		expect(leaf(edited?.description.old, FIRST)).toBe(true);
		expect(leaf(edited?.description.new, SECOND)).toBe(true);
		expect(leaf(edited?.notes.old, NOTE_1)).toBe(true);
		expect(leaf(edited?.notes.new, NOTE_2)).toBe(true);
		expect(edited?.amount).toEqual({ old: 12000, new: 15000 });

		expect(leaf(rejected?.reason, REASON)).toBe(true);
		expect(rejected?.participantType).toBe("user");

		// The snapshot at the delete and at the undo carries the dispute.
		for (const snapshot of [deleted, restored]) {
			expect(leaf(snapshot?.description, SECOND)).toBe(true);
			expect(leaf(snapshot?.notes, NOTE_2)).toBe(true);
			expect(snapshot?.amount).toBe(15000);
			const reasons = snapshot?.splitParticipants.map(
				(s: any) => s.rejectionReason,
			);
			expect(reasons.filter((r: unknown) => r !== null)).toHaveLength(1);
			expect(
				leaf(
					reasons.find((r: unknown) => r !== null),
					REASON,
				),
			).toBe(true);
			expect(
				snapshot?.splitParticipants.map((s: any) => s.shareAmount),
			).toEqual([7500, 7500]);
		}

		// The words are nowhere in a sealed row, and the ids stay readable to SQL.
		for (const row of rows)
			for (const text of TEXTS)
				expect(row.text.includes(text), `${row.action} ${text}`).toBe(
					!sealedSuite && row.text.includes(text),
				);
		expect(
			rows
				.map((r) => r.text)
				.join("")
				.includes(SECOND),
		).toBe(!sealedSuite);
		expect(created?.id).toBe(expenseId);
		expect(created?.projectId).toBe(projectId);
	});

	it.runIf(sealedSuite)(
		"bind each leaf to its entry and path: it opens only where it was sealed",
		async () => {
			const keys = instanceTextKeys();
			await keys.ready();
			const ring = keys.ring("instance");
			if (!ring) throw new Error("no instance ring");
			const edited = (await stored(expenseId))[1];
			if (!edited) throw new Error("no edit entry");
			const sealed = (edited.changes.description as { new: string }).new;
			const at = (rowId: string, path: string) =>
				openField(ring, sealed, {
					table: "audit_log_entry",
					column: `changes:${path}`,
					rowId,
				});
			expect(at(edited.id, "description.new")).toBe(SECOND);
			expect(() => at(edited.id, "description.old")).toThrow();
			expect(() => at(edited.id, "notes.new")).toThrow();
			expect(() => at("another-entry", "description.new")).toThrow();
		},
	);
});

describe("the audit view of the expense", () => {
	it.each([
		["an organizer", () => asSofia],
		["an editor", () => asMartin],
		["a viewer", () => asVera],
	])("reads every revision whole through v1, as %s", async (_who, headers) => {
		const entries = await history(headers());
		expect(entries.map((e) => e.action.type)).toEqual(
			expect.arrayContaining(["created", "edited", "rejected", "deleted"]),
		);
		const edited = only(entries, "edited");
		expect(edited.changes).toMatchObject({
			description: { old: FIRST, new: SECOND },
			notes: { old: NOTE_1, new: NOTE_2 },
			amount: { old: 12000, new: 15000 },
		});
		expect(only(entries, "rejected").changes?.reason).toBe(REASON);
		const deleted = only(entries, "deleted").changes;
		expect(deleted).toMatchObject({
			description: SECOND,
			notes: NOTE_2,
			amount: 15000,
		});
		expect(
			deleted?.splitParticipants.map((s: any) => s.rejectionReason),
		).toContain(REASON);
		expect(JSON.stringify(entries)).not.toContain(SEALED);

		// The restore after the undo is the second creation.
		const created = entries.filter((e) => e.action.type === "created");
		expect(created).toHaveLength(2);
		expect(created.map((e) => e.changes?.description).sort()).toEqual(
			[FIRST, SECOND].sort(),
		);
	});

	it.each([
		["an organizer", () => asSofia],
		["a viewer", () => asVera],
	])(
		"reads the project feed whole through v1, as %s",
		async (_who, headers) => {
			const items = await feed(headers());
			const descriptions = items
				.map((e) => e.changes?.description)
				.filter((d) => typeof d === "string");
			expect(descriptions).toEqual(expect.arrayContaining([SECOND, FIRST]));
			expect(JSON.stringify(items)).not.toContain(SEALED);
			const edited = only(
				items.filter((e) => e.changes?.description?.old),
				"edited",
			);
			expect(edited.changes?.description.new).toBe(SECOND);
		},
	);

	it.each([
		["an organizer", () => owner(sofia.user.id)],
		["a viewer", () => owner(vera.user.id)],
		["a guest", () => guest()],
	])(
		"words the web's history and feed from the opened text, as %s",
		async (_who, caller) => {
			const read = caller();
			const trail = await read.transactionHistory({ transactionId: expenseId });
			const page = await read.projectActivityFeed({ projectId });
			for (const view of [trail, page]) {
				const text = JSON.stringify(view);
				expect(text).not.toContain(SEALED);
				expect(text).toContain(SECOND);
				expect(text).toContain(FIRST);
			}
			// The edit reads as a change of the description and of the amount in ARS.
			expect(JSON.stringify(trail)).toContain(NOTE_2);
		},
	);
});

describe("a project's rename and a period's relabel", () => {
	let periodId: string;

	it("are stored with sealed names and read whole", async () => {
		await expectBody(
			await send("PATCH", `/projects/${projectId}`, asSofia, {
				name: "Viaje a Bariloche",
				description: "Casa de montaña",
			}),
			contract.projects.update,
		);
		const periods = await expectBody<{ items: { id: string }[] }>(
			await call(`/projects/${projectId}/billing-periods`, {
				headers: asSofia,
			}),
			contract["billing-periods"].list,
		);
		periodId = periods.items[0]?.id ?? "";
		await expectBody(
			await send(
				"PATCH",
				`/projects/${projectId}/billing-periods/${periodId}`,
				asSofia,
				{
					id: projectId,
					periodId,
					label: "Primera quincena",
				},
			),
			contract["billing-periods"].rename,
		);

		const entries = await stored(projectId);
		const changesOf = (action: string, key: string) =>
			entries.find((r) => r.action === action && key in r.changes)?.changes;
		const created = changesOf("CREATED", "name");
		const renamed = changesOf("EDITED", "name");
		expect(leaf(created?.name, "Viaje a Cuyo")).toBe(true);
		expect(leaf(renamed?.name.old, "Viaje a Cuyo")).toBe(true);
		expect(leaf(renamed?.name.new, "Viaje a Bariloche")).toBe(true);
		expect(leaf(renamed?.description.new, "Casa de montaña")).toBe(true);
		expect(renamed?.description.old).toBeNull();
		const relabel = (await stored(periodId)).find(
			(r) => "newLabel" in r.changes,
		)?.changes;
		expect(leaf(relabel?.newLabel, "Primera quincena")).toBe(true);
		expect(typeof relabel?.previousLabel).toBe("string");

		for (const who of [asSofia, asVera]) {
			const items = await feed(who);
			const edit = items.find(
				(e) => e.changes?.name?.new === "Viaje a Bariloche",
			);
			expect(edit?.changes).toMatchObject({
				name: { old: "Viaje a Cuyo", new: "Viaje a Bariloche" },
				description: { old: null, new: "Casa de montaña" },
			});
			expect(
				items.find((e) => e.changes?.newLabel === "Primera quincena"),
			).toBeDefined();
			expect(JSON.stringify(items)).not.toContain(SEALED);
		}
		const web = JSON.stringify(
			await guest().projectActivityFeed({ projectId }),
		);
		expect(web).toContain("Primera quincena");
		expect(web).not.toContain(SEALED);
	});
});

describe("path filters over the entries", () => {
	const make = (changes: object) =>
		adminDb.auditLogEntry.create({
			data: {
				actorType: "user",
				actorId: sofia.user.id,
				action: "PARTICIPANT_REMOVED",
				targetType: "SPLIT_PARTICIPANT",
				targetId: `filter-${randomUUID()}`,
				projectId,
				changes,
			},
		});

	it("still find an entry by a path that holds no text, and refuse one that does", async () => {
		const target = randomUUID();
		const entry = await make({
			selfRemoved: true,
			paymentGroupId: target,
			description: { old: "Viejo", new: "Nuevo" },
		});
		const where = (path: string[], equals: unknown) => ({
			id: entry.id,
			changes: { path, equals: equals as never },
		});
		expect(
			await adminDb.auditLogEntry.count({
				where: where(["selfRemoved"], true),
			}),
		).toBe(1);
		expect(
			await adminDb.auditLogEntry.count({
				where: where(["paymentGroupId"], target),
			}),
		).toBe(1);
		await expect(
			adminDb.$queryRaw`SELECT 1 FROM "audit_log_entry"
				WHERE "id" = ${entry.id} AND "changes" ->> 'paymentGroupId' = ${target}`,
		).resolves.toHaveLength(1);
		if (sealedSuite)
			await expect(
				adminDb.auditLogEntry.count({
					where: where(["description", "new"], "Nuevo"),
				}),
			).rejects.toMatchObject({ code: "filter_on_sealed" });
	});
});

describe("entries written before sealing, and moved leaves", () => {
	it("read as written when a leaf is plaintext", async () => {
		const id = `legacy-${randomUUID()}`;
		await adminDb.$executeRaw`INSERT INTO "audit_log_entry"
			("id", "actorType", "actorId", "action", "targetType", "targetId", "changes")
			VALUES (${id}, 'user', ${sofia.user.id}, 'EDITED', 'PROJECT', ${projectId},
				${JSON.stringify({ name: { old: "Antes", new: "Ahora" } })}::jsonb)`;
		try {
			const row = await adminDb.auditLogEntry.findUniqueOrThrow({
				where: { id },
			});
			expect(row.changes).toEqual({ name: { old: "Antes", new: "Ahora" } });
		} finally {
			await adminDb.$executeRaw`DELETE FROM "audit_log_entry" WHERE "id" = ${id}`;
		}
	});

	it.runIf(sealedSuite)(
		"fail to open when moved to another path or another entry",
		async () => {
			const make = (name: string) =>
				adminDb.auditLogEntry.create({
					data: {
						actorType: "user",
						actorId: sofia.user.id,
						action: "EDITED",
						targetType: "PROJECT",
						targetId: projectId,
						projectId,
						changes: { name: { old: name, new: `${name} 2` }, note: "kept" },
					},
				});
			const [a, b] = [await make("Uno"), await make("Dos")];
			const raw = async (id: string) =>
				(
					await adminDb.$queryRaw<{ changes: any }[]>`SELECT "changes"
						FROM "audit_log_entry" WHERE "id" = ${id}`
				)[0]?.changes;
			const put = (id: string, changes: unknown) =>
				adminDb.$executeRaw`UPDATE "audit_log_entry" SET "changes" = ${JSON.stringify(changes)}::jsonb WHERE "id" = ${id}`;
			try {
				const [ra, rb] = [await raw(a.id), await raw(b.id)];
				expect(sealedLeaf(ra.name.new)).toBe(true);
				// Another path of the same entry.
				await put(a.id, {
					...ra,
					name: { old: ra.name.new, new: ra.name.old },
				});
				await expect(
					adminDb.auditLogEntry.findUniqueOrThrow({ where: { id: a.id } }),
				).rejects.toMatchObject({ code: "auth_failed" });
				// The same path of another entry.
				await put(a.id, { ...ra, name: { ...ra.name, new: rb.name.new } });
				await expect(
					adminDb.auditLogEntry.findUniqueOrThrow({ where: { id: a.id } }),
				).rejects.toMatchObject({ code: "auth_failed" });
				await put(a.id, ra);
				const back = await adminDb.auditLogEntry.findUniqueOrThrow({
					where: { id: a.id },
				});
				expect(back.changes).toEqual({
					name: { old: "Uno", new: "Uno 2" },
					note: "kept",
				});
			} finally {
				await adminDb.$executeRaw`DELETE FROM "audit_log_entry" WHERE "id" IN (${a.id}, ${b.id})`;
			}
		},
	);
});

describe("after a crypto-shred", () => {
	it.runIf(sealedSuite)(
		"the audit leaves still open: they are the instance's, not the actor's",
		async () => {
			const ines = await arsUser();
			const asInes = await asMobile(ines.user.id);
			const made = await (
				await send("POST", "/projects", asInes, {
					id: randomUUID(),
					name: "Casa de Ines",
					primaryCurrency: "ARS",
				})
			).json();
			const [row] = await stored(made.id);
			expect(sealedLeaf(row?.changes.name)).toBe(true);
			await destroyDataKeys(ines.user.id);
			const entry = await adminDb.auditLogEntry.findUniqueOrThrow({
				where: { id: row?.id },
			});
			expect(entry.changes).toMatchObject({ name: "Casa de Ines" });
		},
	);
});
