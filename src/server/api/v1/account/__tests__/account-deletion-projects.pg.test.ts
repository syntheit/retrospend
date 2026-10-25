/**
 * What deleting an account does to the projects and ghosts the user made, on
 * Postgres and through the real service (the global client, not the user's
 * own view): a project goes to a remaining member, a ghost in it goes with it
 * so the balances of the people who stay do not change, and ghosts that go
 * keep a sentinel each so no two of them cancel.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { auth } from "~/server/better-auth";
import { deleteOwnAccount } from "~/server/services/account-deletion.service";
import { adminDb } from "~/test/pg-harness";
import { arsUser, seedRates, type TestUser } from "../../__tests__/g3-fixtures";
import {
	asMobile,
	call,
	expectBody,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

vi.mock("~/server/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/storage")>()),
	deleteFile: vi.fn(async () => undefined),
}));

const PASSWORD = "correct horse battery";

async function passwordUser() {
	const { user } = await auth.api.signUpEmail({
		body: {
			email: `${randomUUID()}@pg-test.invalid`,
			password: PASSWORD,
			name: "Dana",
			username: `d${randomBytes(6).toString("hex")}`,
		},
	});
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "ARS" },
	});
	return user.id;
}

const forget = (id: string) => deleteOwnAccount({ id, role: "USER" }, PASSWORD);

async function ghost(createdById: string, name: string) {
	return (await adminDb.shadowProfile.create({ data: { createdById, name } })).id;
}

async function project(
	createdById: string,
	members: { type: "user" | "shadow"; id: string; role: "ORGANIZER" | "EDITOR" | "CONTRIBUTOR" }[],
) {
	const made = await adminDb.project.create({
		data: { name: "Flat", createdById, primaryCurrency: "ARS" },
	});
	for (const m of members)
		await adminDb.projectParticipant.create({
			data: {
				projectId: made.id,
				participantType: m.type,
				participantId: m.id,
				role: m.role,
			},
		});
	return made.id;
}

/** `payer` paid `amount`; each of `split` owes `amount / split.length`. */
async function expense(
	projectId: string | null,
	payer: { type: "user" | "shadow"; id: string },
	split: { type: "user" | "shadow"; id: string }[],
	amount: number,
	createdBy: string,
) {
	const share = String(amount / split.length);
	return adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount: String(amount),
			currency: "ARS",
			date: new Date("2026-10-08"),
			paidByType: payer.type,
			paidById: payer.id,
			createdByType: "user",
			createdById: createdBy,
			projectId,
			splitParticipants: {
				create: split.map((s) => ({
					participantType: s.type,
					participantId: s.id,
					shareAmount: share,
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
}

describe("account deletion: projects and ghosts", () => {
	let ed: TestUser;
	let fay: TestUser;
	let asEd: Record<string, string>;

	beforeAll(async () => {
		await seedRates();
		[ed, fay] = [await arsUser(), await arsUser()];
		asEd = await asMobile(ed.user.id);
	});

	/** What Ed sees between himself and a person: the net and its parts. */
	const balanceWith = async (type: string, id: string) => {
		const page = await expectBody<{ net: unknown; parts: unknown; scopes: unknown }>(
			await call(`/people/${type}/${id}`, { headers: asEd }),
			contract.people.get,
		);
		return JSON.stringify({ net: page.net, parts: page.parts, scopes: page.scopes });
	};

	it("gives ghosts in a project that goes on to its heir and leaves every balance as it was", async () => {
		const dana = await passwordUser();
		const [g1, g2] = [await ghost(dana, "Gus"), await ghost(dana, "Gabi")];
		const flat = await project(dana, [
			{ type: "user", id: dana, role: "ORGANIZER" },
			{ type: "user", id: ed.user.id, role: "EDITOR" },
			{ type: "shadow", id: g1, role: "CONTRIBUTOR" },
			{ type: "shadow", id: g2, role: "CONTRIBUTOR" },
		]);
		const me = { type: "user" as const, id: ed.user.id };
		// Gus owes Ed ARS 50; Ed owes Gabi ARS 40: a debt on one side, a credit on the other.
		await expense(flat, me, [me, { type: "shadow", id: g1 }], 100, ed.user.id);
		await expense(flat, { type: "shadow", id: g2 }, [me, { type: "shadow", id: g2 }], 80, ed.user.id);

		const before = [await balanceWith("shadow", g1), await balanceWith("shadow", g2)];
		expect(before[0]).not.toBe(before[1]);

		await forget(dana);

		expect([await balanceWith("shadow", g1), await balanceWith("shadow", g2)]).toEqual(before);
		const survivors = await adminDb.shadowProfile.findMany({
			where: { id: { in: [g1, g2] } },
		});
		expect(survivors.map((g) => g.createdById)).toEqual([ed.user.id, ed.user.id]);
		const row = await adminDb.project.findUniqueOrThrow({ where: { id: flat } });
		expect(row.createdById).toBe(ed.user.id);
		expect(
			await adminDb.projectParticipant.count({
				where: { projectId: flat, participantType: "shadow" },
			}),
		).toBe(2);
	});

	it("keeps each deleted ghost under its own sentinel, so a debt and a credit never cancel", async () => {
		const dana = await passwordUser();
		const [debtor, creditor] = [await ghost(dana, "Debtor"), await ghost(dana, "Creditor")];
		// No project, so nobody inherits them: Ed and Dana share two private expenses with them.
		const me = { type: "user" as const, id: ed.user.id };
		const dan = { type: "user" as const, id: dana };
		const owes = await expense(null, me, [me, dan, { type: "shadow", id: debtor }], 90, dana);
		const owed = await expense(null, { type: "shadow", id: creditor }, [me, dan, { type: "shadow", id: creditor }], 90, dana);

		await forget(dana);

		const rows = await adminDb.splitParticipant.findMany({
			where: { transactionId: { in: [owes.id, owed.id] }, participantType: "shadow" },
		});
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((r) => r.participantId)).size).toBe(2);
		expect(rows.every((r) => r.participantId !== "DELETED_SHADOW")).toBe(true);
		expect(rows.map((r) => r.participantId).sort()).toEqual(
			[`DELETED_SHADOW_${debtor}`, `DELETED_SHADOW_${creditor}`].sort(),
		);
		// Ed's side of both expenses is untouched.
		const payers = await adminDb.sharedTransaction.findMany({
			where: { id: { in: [owes.id, owed.id] } },
			orderBy: { id: "asc" },
		});
		expect(payers.map((p) => p.paidById).sort()).toEqual(
			[ed.user.id, `DELETED_SHADOW_${creditor}`].sort(),
		);
		expect(await adminDb.shadowProfile.count({ where: { id: { in: [debtor, creditor] } } })).toBe(0);
	});

	it("hands a project to the other organizer when its creator is not the only one", async () => {
		const dana = await passwordUser();
		const flat = await project(dana, [
			{ type: "user", id: dana, role: "ORGANIZER" },
			{ type: "user", id: fay.user.id, role: "ORGANIZER" },
			{ type: "user", id: ed.user.id, role: "EDITOR" },
		]);
		await forget(dana);
		const row = await adminDb.project.findUniqueOrThrow({ where: { id: flat } });
		expect(row.createdById).toBe(fay.user.id);
		const roles = await adminDb.projectParticipant.findMany({
			where: { projectId: flat, participantType: "user" },
		});
		expect(roles.find((r) => r.participantId === fay.user.id)?.role).toBe("ORGANIZER");
		expect(roles.some((r) => r.participantId === dana)).toBe(false);
	});

	it("deletes the account of a creator who is not a member of their project", async () => {
		const dana = await passwordUser();
		const g = await ghost(dana, "Gus");
		const flat = await project(dana, [
			{ type: "user", id: ed.user.id, role: "ORGANIZER" },
			{ type: "shadow", id: g, role: "CONTRIBUTOR" },
		]);
		await expense(flat, { type: "user", id: ed.user.id }, [
			{ type: "user", id: ed.user.id },
			{ type: "shadow", id: g },
		], 60, ed.user.id);
		const before = await balanceWith("shadow", g);

		await forget(dana);

		expect(await adminDb.user.count({ where: { id: dana } })).toBe(0);
		const row = await adminDb.project.findUniqueOrThrow({ where: { id: flat } });
		expect(row.createdById).toBe(ed.user.id);
		expect(await balanceWith("shadow", g)).toBe(before);
		expect((await adminDb.shadowProfile.findUniqueOrThrow({ where: { id: g } })).createdById).toBe(ed.user.id);
	});

	it("deletes a project with nobody left on Retrospend, and its ghosts with it", async () => {
		const dana = await passwordUser();
		const g = await ghost(dana, "Gus");
		const flat = await project(dana, [
			{ type: "user", id: dana, role: "ORGANIZER" },
			{ type: "shadow", id: g, role: "CONTRIBUTOR" },
		]);
		await forget(dana);
		expect(await adminDb.project.count({ where: { id: flat } })).toBe(0);
		expect(await adminDb.shadowProfile.count({ where: { id: g } })).toBe(0);
	});
});
