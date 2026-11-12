/**
 * people.search matches names in the app layer (E2EE lane D10), so it no longer
 * asks Postgres for `name ILIKE`. On plaintext rows it must answer what the
 * old queries answered: the old Prisma `contains` filters are copied below as
 * the oracle, for the ghosts the caller can see and for the people they have
 * shared with.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import {
	arsUser,
	ref,
	seedProject,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { adminDb, sealedSuite } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { peopleRouter } from "../people";

const as = (u: TestUser) =>
	createCallerFactory(peopleRouter)({
		session: makeSession({ id: u.user.id, name: u.user.name }),
		db: u.db,
		headers: new Headers(),
	});

let me: TestUser;
const sorted = (ids: string[]) => [...ids].sort();

/** The old shadow query plus the old literal filter, for ghosts whose email I can see. */
async function oldShadowIds(query: string) {
	const found = await me.db.shadowProfile.findMany({
		where: {
			claimedById: null,
			OR: [
				{ name: { contains: query, mode: "insensitive" } },
				{ email: { contains: query, mode: "insensitive" } },
			],
		},
		select: { id: true, name: true, email: true },
		take: 50,
	});
	return found
		.filter(
			(s) =>
				s.name.toLowerCase().includes(query) ||
				(s.email?.toLowerCase().includes(query) ?? false),
		)
		.slice(0, 10)
		.map((s) => s.id);
}

/** The old query for the people I have shared with. */
async function oldContactIds(query: string, contactIds: string[]) {
	const found = await me.db.user.findMany({
		where: {
			id: { in: contactIds },
			OR: [
				{ name: { contains: query, mode: "insensitive" } },
				{ email: { contains: query, mode: "insensitive" } },
				{ username: { contains: query, mode: "insensitive" } },
			],
		},
		select: { id: true },
		take: 10,
	});
	return found.map((u) => u.id);
}

const CONTACTS: [string, string][] = [
	["Muñoz & hijos", "mhijos"],
	["MARÍA José", "mjose"],
	["Ángel", "angel_x"],
	["café owner", "cafeown"],
	["snake_case", "snake"],
	["100% club", "club100"],
	["Zed", "zed"],
];
const SHADOWS: [string, string | null][] = [
	["Muñoz ghost", null],
	["Mariana", "mariana@mail.test"],
	["Zed shadow", "zed.shadow@mail.test"],
	["snake_case ghost", null],
	["100% ghost", "pct@mail.test"],
	["Dana", "cafe@mail.test"],
];
const QUERIES = [
	"mun",
	"muñoz",
	"maria",
	"mar",
	"_",
	"%",
	"snake",
	"ang",
	"zed",
	"cafe",
	"mail.test",
	"100",
	"zzz",
	"x",
];

beforeAll(async () => {
	me = await arsUser();
	for (const [i, [name, username]] of CONTACTS.entries()) {
		const u = await arsUser();
		await adminDb.user.update({
			where: { id: u.user.id },
			data: {
				name,
				username: `${username}_${u.user.id.slice(0, 8)}`,
				email: `${i}_${u.user.id.slice(0, 8)}@people.test`,
			},
		});
		if (i % 2 === 0) await seedShare(ref(me), ref(u), "100", "ARS");
		else await seedProject(me, [{ user: u, role: "EDITOR" }]);
	}
	for (const [name, email] of SHADOWS)
		await adminDb.shadowProfile.create({
			data: { createdById: me.user.id, name, email },
		});
});

// The oracle is the old SQL over stored names, which the sealed suite
// (PG_TEST_SEALED) seals: it runs only where the names are plaintext.
describe.skipIf(sealedSuite)("people.search matches the old queries", () => {
	it.each(QUERIES)("for %j", async (q) => {
		const out = await as(me).search({ query: q });
		const query = q.toLowerCase();
		expect(sorted(out.shadows.map((s) => s.participantId))).toEqual(
			sorted(await oldShadowIds(query)),
		);
		const contactIds = (
			await me.db.splitParticipant.findMany({
				where: {
					participantType: "user",
					participantId: { not: me.user.id },
					transaction: {
						splitParticipants: {
							some: { participantType: "user", participantId: me.user.id },
						},
					},
				},
				select: { participantId: true },
				distinct: ["participantId"],
			})
		).map((c) => c.participantId);
		// "Contacts" in the router are the people I share an expense with.
		expect(contactIds.length).toBeGreaterThan(0);
		const expectedUsers = await oldContactIds(query, contactIds);
		expect(
			sorted(
				out.users
					.map((u) => u.participantId)
					.filter((id) => contactIds.includes(id)),
			),
		).toEqual(sorted(expectedUsers));
	});

	it("caps the answers at 10 ghosts and 10 contacts", async () => {
		const busy = await arsUser();
		for (let i = 0; i < 14; i++) {
			await adminDb.shadowProfile.create({
				data: { createdById: busy.user.id, name: `Crowd ${i}` },
			});
			const u = await arsUser();
			await adminDb.user.update({
				where: { id: u.user.id },
				data: { name: `Crowd user ${i}` },
			});
			await seedShare(ref(busy), ref(u), "10", "ARS");
		}
		const out = await as(busy).search({ query: "crowd" });
		expect(out.shadows).toHaveLength(10);
		expect(out.users).toHaveLength(10);
	});

	it("does not match a ghost by an email the caller may not see", async () => {
		const owner = await arsUser();
		const ghost = await adminDb.shadowProfile.create({
			data: {
				createdById: owner.user.id,
				name: "Hidden mail",
				email: "secret.address@mail.test",
			},
		});
		const org = await arsUser();
		const projectId = await seedProject(owner, [{ user: org, role: "VIEWER" }]);
		await adminDb.projectParticipant.create({
			data: {
				projectId,
				participantType: "shadow",
				participantId: ghost.id,
				role: "CONTRIBUTOR",
			},
		});
		const seen = await as(org).search({ query: "secret.address" });
		expect(seen.shadows).toEqual([]);
		const byName = await as(org).search({ query: "hidden" });
		expect(byName.shadows).toEqual([
			{
				participantType: "shadow",
				participantId: ghost.id,
				name: "Hidden mail",
				email: null,
			},
		]);
	});
});
