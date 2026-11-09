/**
 * v1 search over people, projects and categories in the app layer against the
 * SQL it replaced (E2EE lane D10). The old queries are copied here as the
 * oracle: `immutable_unaccent(x) ILIKE` with the cursor and the order cut by
 * Postgres. On plaintext rows the new code must return the same rows in the
 * same order, page by page, for accents, case, LIKE wildcards in the query
 * and names that sort differently by code point.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	arsUser,
	ref,
	seedProject,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { userTransaction } from "~/server/db-tx";
import {
	type CategoryHitRow,
	type PersonHitRow,
	type ProjectHitRow,
	searchCategories,
	searchPeople,
	searchProjects,
} from "~/server/services/search.service";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";

type Page<K> = { after: K | null; take: number };

// ---- the old SQL, as the oracle -------------------------------------------

const containsPattern = (q: string) =>
	`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const matches = (column: Prisma.Sql, pattern: string) =>
	Prisma.sql`public.immutable_unaccent(${column}) ILIKE public.immutable_unaccent(${pattern}) ESCAPE '\\'`;

function oldPeople(
	userId: string,
	q: string,
	page: Page<{ name: string; participantType: string; id: string }>,
) {
	const p = containsPattern(q);
	const after = page.after
		? Prisma.sql`WHERE ("name", "participantType", "id") > (${page.after.name}, ${page.after.participantType}, ${page.after.id})`
		: Prisma.empty;
	return userTransaction(
		adminDb,
		userId,
		(tx) => tx.$queryRaw<PersonHitRow[]>`
			SELECT * FROM (
				SELECT 'user' AS "participantType", u."id", u."name", u."username"
				FROM "user" u
				WHERE u."id" <> ${userId}
					AND (${matches(Prisma.sql`u."name"`, p)} OR ${matches(Prisma.sql`u."username"`, p)})
					AND (
						EXISTS (
							SELECT 1 FROM "split_participant" me
							JOIN "split_participant" them ON them."transactionId" = me."transactionId"
							WHERE me."participantType" = 'user' AND me."participantId" = ${userId}
								AND them."participantType" = 'user' AND them."participantId" = u."id")
						OR EXISTS (
							SELECT 1 FROM "project_participant" me
							JOIN "project_participant" them ON them."projectId" = me."projectId"
							WHERE me."participantType" = 'user' AND me."participantId" = ${userId}
								AND them."participantType" = 'user' AND them."participantId" = u."id")
					)
				UNION ALL
				SELECT 'shadow', s."id", s."name", NULL
				FROM "shadow_profile" s
				WHERE s."claimedById" IS NULL AND ${matches(Prisma.sql`s."name"`, p)}
			) people
			${after}
			ORDER BY "name", "participantType", "id"
			LIMIT ${page.take}`,
	);
}

function oldProjects(
	userId: string,
	q: string,
	page: Page<{ name: string; id: string }>,
) {
	const p = containsPattern(q);
	const after = page.after
		? Prisma.sql`AND (pr."name", pr."id") > (${page.after.name}, ${page.after.id})`
		: Prisma.empty;
	return userTransaction(
		adminDb,
		userId,
		(tx) => tx.$queryRaw<ProjectHitRow[]>`
			SELECT pr."id", pr."name", pr."status"::text AS "status"
			FROM "project" pr
			WHERE EXISTS (
					SELECT 1 FROM "project_participant" pp
					WHERE pp."projectId" = pr."id"
						AND pp."participantType" = 'user' AND pp."participantId" = ${userId})
				AND (${matches(Prisma.sql`pr."name"`, p)}
					OR ${matches(Prisma.sql`coalesce(pr."description", '')`, p)})
				${after}
			ORDER BY pr."name", pr."id"
			LIMIT ${page.take}`,
	);
}

function oldCategories(
	userId: string,
	q: string,
	page: Page<{ name: string; id: string }>,
) {
	const p = containsPattern(q);
	const after = page.after
		? Prisma.sql`AND ("name", "id") > (${page.after.name}, ${page.after.id})`
		: Prisma.empty;
	return userTransaction(
		adminDb,
		userId,
		(tx) => tx.$queryRaw<CategoryHitRow[]>`
			SELECT "id", "name", "color"::text AS "color"
			FROM "category"
			WHERE "userId" = ${userId} AND ${matches(Prisma.sql`"name"`, p)}
				${after}
			ORDER BY "name", "id"
			LIMIT ${page.take}`,
	);
}

// ---- the ledger -------------------------------------------------------------

const QUERIES = [
	"cafe",
	"CAFÉ",
	"mun",
	"muñoz",
	"MARIA",
	"angel",
	"_",
	"%",
	"\\",
	"ñ",
	"a",
	"e",
	"zzz",
	"strasse",
	"STRAßE",
	"100%",
	"😀",
	"  ",
];

const NAMES = [
	"Muñoz & hijos",
	"María José",
	"ÁNGEL",
	"café owner",
	"Cafe de la esquina",
	"zed",
	"Zed",
	"Straße trip",
	"100% club",
	"snake_case",
	"😀 party",
	" odd",
	"Ñandú",
	"a",
];

let me: TestUser;
const unknownIds = new Set<string>();

async function userNamed(name: string, username: string) {
	const u = await arsUser();
	await adminDb.user.update({
		where: { id: u.user.id },
		data: { name, username },
	});
	return u;
}

beforeAll(async () => {
	me = await arsUser();
	const stranger = await arsUser();
	// Users I share with: by an expense, and by a project.
	for (const [i, name] of NAMES.entries()) {
		const u = await userNamed(name, `d10_${i}_${stranger.user.id.slice(0, 8)}`);
		if (i % 2 === 0) await seedShare(ref(me), ref(u), "100", "ARS");
		else await seedProject(me, [{ user: u, role: "EDITOR" }]);
	}
	// A matching user I share nothing with must not show.
	const hidden = await userNamed(
		"Muñoz hidden",
		`d10_hidden_${stranger.user.id.slice(0, 8)}`,
	);
	unknownIds.add(hidden.user.id);
	// My people, one claimed (not listed), and a stranger's (hidden by RLS).
	for (const name of [...NAMES, "Muñoz ghost", "Mariana"])
		await adminDb.shadowProfile.create({
			data: { createdById: me.user.id, name },
		});
	await adminDb.shadowProfile.create({
		data: {
			createdById: me.user.id,
			name: "Muñoz claimed",
			claimedById: stranger.user.id,
		},
	});
	await adminDb.shadowProfile.create({
		data: { createdById: stranger.user.id, name: "Muñoz stranger" },
	});
	// Projects I am in, by name and by description, and one I am not in.
	for (const [i, name] of NAMES.entries())
		await adminDb.project.create({
			data: {
				name: `P ${name}`,
				description: i % 3 === 0 ? `about ${name}` : null,
				createdById: me.user.id,
				participants: {
					create: [{ ...ref(me), role: "ORGANIZER" }],
				},
			},
		});
	await adminDb.project.create({
		data: { name: "Muñoz not mine", createdById: stranger.user.id },
	});
	for (const name of NAMES)
		await adminDb.category.create({
			data: { name, color: "teal", userId: me.user.id },
		});
	await adminDb.category.create({
		data: { name: "Muñoz theirs", color: "teal", userId: stranger.user.id },
	});
});

/** Walks both implementations page by page and compares every page. */
async function walk<Row extends { id: string; name: string }, K>(
	oldQuery: (page: Page<K>) => Promise<Row[]>,
	newQuery: (page: Page<K>) => Promise<Row[]>,
	cursorOf: (row: Row) => K,
	take: number,
) {
	let after: K | null = null;
	const all: Row[] = [];
	for (;;) {
		const page = { after, take };
		const expected = await oldQuery(page);
		const got = await newQuery(page);
		expect(got).toEqual(expected);
		all.push(...got);
		const last = got.at(-1);
		if (got.length < take || !last) return all;
		after = cursorOf(last);
	}
}

describe("people search matches the old SQL", () => {
	it.each(QUERIES)("for %j, page by page", async (q) => {
		const rows = await walk<
			PersonHitRow,
			{ name: string; participantType: string; id: string }
		>(
			(page) => oldPeople(me.user.id, q, page),
			(page) => searchPeople(me.db, me.user.id, q, page),
			(r) => ({ name: r.name, participantType: r.participantType, id: r.id }),
			3,
		);
		expect(rows.some((r) => unknownIds.has(r.id))).toBe(false);
		expect(rows.every((r) => !r.name.includes("claimed"))).toBe(true);
		expect(rows.every((r) => !r.name.includes("stranger"))).toBe(true);
	});

	it("finds users by username and by an unaccented name, and shadows by name", async () => {
		const byName = await searchPeople(me.db, me.user.id, "munoz", {
			after: null,
			take: 50,
		});
		expect(byName.map((r) => `${r.participantType}:${r.name}`)).toEqual(
			expect.arrayContaining([
				"user:Muñoz & hijos",
				"shadow:Muñoz & hijos",
				"shadow:Muñoz ghost",
			]),
		);
		const byUsername = await searchPeople(me.db, me.user.id, "d10_2_", {
			after: null,
			take: 50,
		});
		expect(byUsername.map((r) => r.name)).toEqual(["ÁNGEL"]);
	});
});

describe("project search matches the old SQL", () => {
	it.each(QUERIES)("for %j, page by page", async (q) => {
		const rows = await walk<ProjectHitRow, { name: string; id: string }>(
			(page) => oldProjects(me.user.id, q, page),
			(page) => searchProjects(me.db, me.user.id, q, page),
			(r) => ({ name: r.name, id: r.id }),
			3,
		);
		expect(rows.every((r) => !r.name.includes("not mine"))).toBe(true);
	});

	it("matches the description as well as the name", async () => {
		const rows = await searchProjects(me.db, me.user.id, "about zed", {
			after: null,
			take: 10,
		});
		expect(rows.map((r) => r.name)).toEqual(["P Zed"]);
	});
});

describe("category search matches the old SQL", () => {
	it.each(QUERIES)("for %j, page by page", async (q) => {
		const rows = await walk<CategoryHitRow, { name: string; id: string }>(
			(page) => oldCategories(me.user.id, q, page),
			(page) => searchCategories(me.db, me.user.id, q, page),
			(r) => ({ name: r.name, id: r.id }),
			3,
		);
		expect(rows.every((r) => !r.name.includes("theirs"))).toBe(true);
	});
});

describe("people search reads a bounded window", () => {
	it("keeps the newest users and the newest ghosts, and drops the rest", async () => {
		const owner = await arsUser();
		const day = (n: number) => new Date(Date.UTC(2026, 0, n));
		for (let n = 1; n <= 4; n++) {
			const u = await userNamed(
				`Window user ${n}`,
				`d10_win_${n}_${owner.user.id.slice(0, 8)}`,
			);
			await adminDb.user.update({
				where: { id: u.user.id },
				data: { createdAt: day(n) },
			});
			await seedShare(ref(owner), ref(u), "10", "ARS");
			await adminDb.shadowProfile.create({
				data: {
					createdById: owner.user.id,
					name: `Window ghost ${n}`,
					createdAt: day(n),
				},
			});
		}
		const hits = (window: number) =>
			searchPeople(
				owner.db,
				owner.user.id,
				"window",
				{ after: null, take: 50 },
				{ window },
			).then((rows) => rows.map((r) => r.name));
		expect(await hits(2)).toEqual([
			"Window ghost 3",
			"Window ghost 4",
			"Window user 3",
			"Window user 4",
		]);
		expect(await hits(4)).toHaveLength(8);
		expect(await hits(20_000)).toHaveLength(8);
	});
});
