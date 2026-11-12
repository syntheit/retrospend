/**
 * Text search in the app layer against the SQL it replaced. The old queries
 * are copied here as the oracle: Activity folded with `lower(translate())`,
 * v1 search with `immutable_unaccent() ILIKE`. On a plaintext ledger the new
 * code must return the same rows in the same order, page by page. Then the
 * same searches over rows that hold ciphertext, sealed with the owner's key
 * and opened by the model reads. The app-layer path is the one taken once the
 * field encryption epoch exists; its batches are covered in
 * search-batches.pg.test.ts.
 */
import { randomUUID } from "node:crypto";
import { fromWallTime } from "@retrospend/domain/time-zone";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	FieldCryptoError,
	type Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import { userTransaction } from "~/server/db-tx";
import { listActivity } from "~/server/services/expense-list";
import {
	amountCandidates,
	FOLD_FROM,
	FOLD_TO,
} from "~/server/services/expense-list/search";
import { listV2Input } from "~/server/services/expense-list/types";
import { searchExpenses as searchExpensesWith } from "~/server/services/search.service";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import {
	sealedFile,
	sealText,
	userKeyring,
	writeCell,
	writeEpoch,
} from "~/test/sealed-fixture";
import { Prisma } from "~prisma";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));
sealedFile(master);

const TZ = "America/Argentina/Buenos_Aires";
const day = (d: number, m = 10) =>
	fromWallTime({ year: 2026, month: m - 1, day: d }, TZ);
const NOW = new Date("2026-10-21T15:00:00Z");
/** Both ways to match text, picked by the epoch. Plaintext rows must give the same answer on each. */
const PATHS = [
	["the SQL path (no epoch)", false],
	["the app-layer path (epoch)", true],
] as const;

/** The block's path; no epoch again after it. */
function onPath(epoch: boolean) {
	beforeAll(() => writeEpoch(epoch));
	afterAll(() => writeEpoch(false));
}

type Who = Awaited<ReturnType<typeof createTestUser>>;
let me: Who;
let other: Who;

const base = (userId: string) => ({
	userId,
	amount: "1500",
	currency: "ARS",
	amountInUSD: "1.5",
	exchangeRate: "1000",
	pricingSource: "MANUAL",
});

// ---- the old SQL, as the oracle -------------------------------------------

/** The old Activity query: translate/lower on the columns, LIKE pattern. */
async function oldActivityIds(userId: string, rawQ: string): Promise<string[]> {
	const fromTo = new Map([...FOLD_FROM].map((c, i) => [c, [...FOLD_TO][i]]));
	const folded = [...rawQ.trim().normalize("NFC")]
		.map((c) => fromTo.get(c) ?? c)
		.join("")
		.toLowerCase();
	const p = `%${folded.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	const nums = amountCandidates(rawQ);
	const fold = (col: Prisma.Sql) =>
		Prisma.sql`lower(translate(${col}, ${FOLD_FROM}, ${FOLD_TO}))`;
	const like = (col: Prisma.Sql) => Prisma.sql`${fold(col)} LIKE ${p}`;
	const amount = (col: Prisma.Sql) =>
		nums.length
			? Prisma.sql`${col} = ANY(${nums}::numeric[])`
			: Prisma.sql`false`;
	const rows = await userTransaction(
		adminDb,
		userId,
		(tx) =>
			tx.$queryRaw<{ src: string; id: string }[]>`
			SELECT u.src, u.id FROM (
				SELECT 'p'::text AS src, e.id, e.date, e."createdAt" AS created FROM expense e
				WHERE e."userId" = ${userId} AND e.status = 'FINALIZED' AND e."isAmortizedChild" = false
					AND (${like(Prisma.sql`e.title`)} OR ${like(Prisma.sql`coalesce(e.description, '')`)}
						OR ${like(Prisma.sql`coalesce(e.location, '')`)} OR ${amount(Prisma.sql`e.amount`)})
				UNION ALL
				SELECT 's', st.id, st.date, st."createdAt" FROM shared_transaction st
				JOIN split_participant sp ON sp."transactionId" = st.id
					AND sp."participantType" = 'user' AND sp."participantId" = ${userId}
				WHERE ${like(Prisma.sql`st.description`)} OR ${like(Prisma.sql`coalesce(st.notes, '')`)}
					OR ${amount(Prisma.sql`st.amount`)} OR ${amount(Prisma.sql`sp."shareAmount"`)}
				UNION ALL
				SELECT 'g', g.key, g.date, g.date FROM (
					SELECT coalesce(s."paymentGroupId", s.id) || '|' || s.currency AS key,
						min(s."initiatedAt") AS date, sum(s.amount) AS amount,
						coalesce(min(s.note), '') || ' ' || coalesce(min(s."paymentMethod"), '') AS words
					FROM settlement s
					WHERE s."isOffset" = false AND s.kind = 'PAYMENT' AND s.status <> 'REJECTED'
						AND (s."fromParticipantId" = ${userId} OR s."toParticipantId" = ${userId})
					GROUP BY 1) g
				WHERE ${like(Prisma.sql`g.words`)} OR ${amount(Prisma.sql`g.amount`)}
			) u ORDER BY u.date DESC, u.created DESC, u.src DESC, u.id DESC`,
	);
	return rows.map((r) =>
		r.src === "s" ? `shared:${r.id}` : r.src === "g" ? `payment:${r.id}` : r.id,
	);
}

type Hit = { id: string; title: string; date: Date };

/** The old v1 expense search, verbatim. */
async function oldSearchExpenses(
	userId: string,
	q: string,
	after: { date: string; id: string } | null,
	take: number,
): Promise<Hit[]> {
	const p = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	const m = (col: Prisma.Sql) =>
		Prisma.sql`public.immutable_unaccent(${col}) ILIKE public.immutable_unaccent(${p}) ESCAPE '\\'`;
	const cursor = after
		? Prisma.sql`AND ("date", "id") < (${new Date(after.date)}, ${after.id})`
		: Prisma.empty;
	return userTransaction(
		adminDb,
		userId,
		(tx) =>
			tx.$queryRaw<Hit[]>`
			SELECT "id", "title", "date" FROM "expense"
			WHERE "userId" = ${userId} AND "status" = 'FINALIZED' AND "isAmortizedChild" = false
				AND (${m(Prisma.sql`"title"`)} OR ${m(Prisma.sql`coalesce("description", '')`)}
					OR ${m(Prisma.sql`coalesce("location", '')`)})
				${cursor}
			ORDER BY "date" DESC, "id" DESC LIMIT ${take}`,
	);
}

// ---- the ledger -------------------------------------------------------------

beforeAll(async () => {
	me = await createTestUser();
	other = await createTestUser();
	await adminDb.user.updateMany({
		where: { id: { in: [me.user.id, other.user.id] } },
		data: { homeCurrency: "ARS" },
	});
	await adminDb.exchangeRate.create({
		data: { date: day(1), currency: "ARS", type: "official", rate: "1000" },
	});
	const row = (
		title: string,
		date: Date,
		extra: Record<string, unknown> = {},
	) => ({ ...base(me.user.id), title, date, ...extra });
	await fixtureDb.expense.createMany({
		data: [
			row("Café con leche", day(1)),
			row("CAFE molido", day(2)),
			row("Cafetería Martínez", day(3)),
			row("Ñandú asado", day(4), { description: "Cena para la oficina" }),
			row("NANDU", day(4)),
			row("100% jugo", day(5)),
			row("under_score", day(6)),
			row("Muñoz & Hijos", day(7), { location: "Plaza Ñuñoa" }),
			row("İstanbul trip", day(8)),
			row("Straße", day(9)),
			row("ΟΔΟΣ", day(13)),
			row("Super", day(10), {
				amount: "64000",
				description: "café de la esquina",
			}),
			row("Draft café", day(12), { status: "DRAFT" }),
			row("Old café", day(10, 8)),
		],
	});
	// Six rows with the same date and the same createdAt: the id breaks the tie.
	const same = new Date("2026-10-11T15:00:00Z");
	await fixtureDb.expense.createMany({
		data: Array.from({ length: 6 }, (_, i) =>
			row(`Tie café ${i}`, day(11), { createdAt: same }),
		),
	});
	await fixtureDb.expense.create({
		data: { ...base(other.user.id), title: "Café de Bob", date: day(5) },
	});
	await adminDb.sharedTransaction.create({
		data: {
			id: "sal_tx",
			description: "Cena café",
			notes: "Cumpleaños de Martín",
			amount: "30000",
			currency: "ARS",
			exchangeRate: "1000",
			date: day(4),
			paidByType: "user",
			paidById: other.user.id,
			createdByType: "user",
			createdById: other.user.id,
			splitParticipants: {
				create: [
					{
						participantType: "user",
						participantId: me.user.id,
						shareAmount: "15000",
						verificationStatus: "ACCEPTED",
					},
					{
						participantType: "user",
						participantId: other.user.id,
						shareAmount: "15000",
						verificationStatus: "ACCEPTED",
					},
				],
			},
		},
	});
	await adminDb.payment.create({
		data: {
			id: "sal_group",
			payerType: "user",
			payerId: other.user.id,
			payeeType: "user",
			payeeId: me.user.id,
			amount: "15000",
			currency: "ARS",
			paidOn: day(6),
			recordedByType: "user",
			recordedById: other.user.id,
		},
	});
	await adminDb.settlement.createMany({
		data: ["sal_s1", "sal_s2"].map((id) => ({
			id,
			fromParticipantType: "user" as const,
			fromParticipantId: other.user.id,
			toParticipantType: "user" as const,
			toParticipantId: me.user.id,
			currency: "ARS",
			amount: "7500",
			status: "FINALIZED" as const,
			initiatedAt: day(6),
			paymentGroupId: "sal_group",
			note: "Devolución café",
			paymentMethod: "Transferencia",
		})),
	});
});

const ACTIVITY_QUERIES = [
	"cafe",
	"CAFÉ",
	"caf",
	"con leche",
	"con",
	"ñandú",
	"nandu",
	"ÑUÑOA",
	"100%",
	"_",
	"muñoz & hijos",
	"istanbul",
	"strasse",
	"straße",
	"cumpleanos",
	"devolucion",
	"transferencia",
	"devolución café transferencia",
	"cena",
	"oficina",
	"esquina",
	"  cafe  ",
	"tie caf",
	"64000",
	"64.000",
	"15000",
	"7500",
	"zzz",
];

const activity = (q: string, extra: object = {}) =>
	listActivity(me.db, me.user.id, listV2Input.parse({ q, ...extra }), TZ, NOW);

describe.each(PATHS)("Activity search on %s vs the old SQL", (_name, epoch) => {
	onPath(epoch);

	it.each(ACTIVITY_QUERIES)(
		"returns the old rows in the old order for %j",
		async (q) => {
			const want = await oldActivityIds(me.user.id, q);
			const got = await activity(q, { limit: 200 });
			expect(got.items.map((i) => i.id)).toEqual(want);
		},
	);

	it("finds accents, case, partial words, notes and titles", async () => {
		const titles = async (q: string) =>
			(await activity(q, { limit: 200 })).items.map((i) => i.title);
		expect(await titles("cafeteria")).toEqual(["Cafetería Martínez"]);
		expect(await titles("OFICINA")).toEqual(["Ñandú asado"]);
		expect(await titles("ñuñoa")).toEqual(["Muñoz & Hijos"]);
		expect(await titles("esquina")).toEqual(["Super"]);
		expect(await titles("nandu")).toEqual(["NANDU", "Ñandú asado"]);
		expect(await titles("100%")).toEqual(["100% jugo"]);
		expect(await titles("_")).toEqual(["under_score"]);
	});

	it("matches the shared expense's notes and the payment's note", async () => {
		const ids = async (q: string) =>
			(await activity(q, { limit: 200 })).items.map((i) => i.id);
		expect(await ids("cumpleanos")).toEqual(["shared:sal_tx"]);
		expect(await ids("devolucion")).toEqual(["payment:sal_group|ARS"]);
	});

	it("pages exactly as the old query did, ties included", async () => {
		for (const q of ["cafe", "tie", "caf"]) {
			const want = await oldActivityIds(me.user.id, q);
			const seen: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await activity(q, { limit: 3, cursor });
				seen.push(...page.items.map((i) => i.id));
				cursor = page.nextCursor ?? undefined;
			} while (cursor);
			expect(seen, q).toEqual(want);
		}
	});

	it("counts every match on the first page", async () => {
		const first = await activity("cafe", { limit: 2 });
		expect(first.count).toBe((await oldActivityIds(me.user.id, "cafe")).length);
		expect(first.nextCursor).not.toBeNull();
	});

	it("keeps the other filters in SQL: dates and the draft", async () => {
		const oct = await activity("cafe", {
			from: "2026-10-01",
			to: "2026-10-31",
			limit: 200,
		});
		expect(oct.items.map((i) => i.title)).not.toContain("Old café");
		expect(oct.items.map((i) => i.title)).not.toContain("Draft café");
		expect(oct.items.map((i) => i.title)).not.toContain("Café de Bob");
	});

	it("lowercases per letter as lower() does: sigma and I with dot", async () => {
		const titles = async (q: string) =>
			(await activity(q, { limit: 5 })).items.map((i) => i.title);
		// The query "ΟΔΟΣ" used to fold to a final sigma and miss the column.
		expect(await titles("ΟΔΟΣ")).toEqual(["ΟΔΟΣ"]);
		expect(await titles("οδοσ")).toEqual(["ΟΔΟΣ"]);
		expect(await titles("istanbul")).toEqual(["İstanbul trip"]);
		expect(await titles("İSTANBUL")).toEqual(["İstanbul trip"]);
	});

	it("treats an I with dot as an i, as lower() does", async () => {
		expect(
			(await activity("İSTANBUL", { limit: 5 })).items.map((i) => i.title),
		).toEqual(["İstanbul trip"]);
	});
});

describe.each(PATHS)(
	"v1 expense search on %s vs the old SQL",
	(_name, epoch) => {
		onPath(epoch);
		const searchExpenses = searchExpensesWith;

		const V1_QUERIES = [
			"cafe",
			"CAFÉ",
			"caf",
			"con leche",
			"ñandú",
			"nandu",
			"ÑUÑOA",
			"100%",
			"_",
			"\\",
			"muñoz & hijos",
			"istanbul",
			"İSTANBUL",
			"strasse",
			"STRAßE",
			"oficina",
			"café de la",
			"  cafe",
			"zzz",
		];

		it.each(V1_QUERIES)(
			"pages the same rows as the old SQL for %j",
			async (q) => {
				let after: { date: string; id: string } | null = null;
				for (let guard = 0; guard < 20; guard++) {
					const want = await oldSearchExpenses(me.user.id, q, after, 3);
					const got = await searchExpenses(adminDb, me.user.id, q, {
						after,
						take: 3,
					});
					expect(
						got.map((r) => ({ id: r.id, title: r.title })),
						`${q} after ${after?.id}`,
					).toEqual(want.map((r) => ({ id: r.id, title: r.title })));
					const last = want.at(-1);
					if (want.length < 3 || !last) return;
					after = { date: last.date.toISOString(), id: last.id };
				}
			},
		);

		it("finds Straße by strasse and by the accented spelling", async () => {
			const titles = async (q: string) =>
				(
					await searchExpenses(adminDb, me.user.id, q, { after: null, take: 5 })
				).map((r) => r.title);
			expect(await titles("strasse")).toEqual(["Straße"]);
			expect(await titles("straße")).toEqual(["Straße"]);
		});

		it("returns money columns as text for the caller to shape", async () => {
			const [hit] = await searchExpenses(adminDb, me.user.id, "super", {
				after: null,
				take: 1,
			});
			expect(hit?.currency).toBe("ARS");
			expect(new Prisma.Decimal(hit?.amount ?? "0").equals("64000")).toBe(true);
		});
	},
);

describe("rows that hold ciphertext", () => {
	let user: Who;
	const ids: Record<string, string> = {};
	onPath(true);

	beforeAll(async () => {
		user = await createTestUser();
		const titles: [string, string | null, string | null][] = [
			["Café sealed", null, null],
			["Plain café", null, null],
			["Almuerzo", "Sealed café note", null],
			["Sealed Ñandú", null, "Plaza Ñuñoa"],
			["Plain Ñandú", null, null],
			["Other", null, null],
		];
		for (const [i, [title, description, location]] of titles.entries()) {
			const created = await fixtureDb.expense.create({
				data: {
					...base(user.user.id),
					title,
					description,
					location,
					date: day(1 + i),
				},
			});
			ids[title] = created.id;
		}
		// Sealed with the owner's key and written raw; no keyring is passed
		// anywhere, the model reads open them.
		const seal = (column: string, rowId: string, text: string) =>
			sealText(
				master.ring as Keyring,
				{ table: "expense", column, rowId },
				text,
			);
		await seal("title", ids["Café sealed"] ?? "", "Café sealed");
		await seal("description", ids.Almuerzo ?? "", "Sealed café note");
		await seal("title", ids["Sealed Ñandú"] ?? "", "Sealed Ñandú");
		await seal("location", ids["Sealed Ñandú"] ?? "", "Plaza Ñuñoa");
	});

	const keys = async (q: string) =>
		(
			await listActivity(
				adminDb,
				user.user.id,
				listV2Input.parse({ q, limit: 50 }),
				TZ,
				NOW,
			)
		).items.map((i) => i.id);

	it("with the epoch, Activity matches sealed and plain titles, notes and places together", async () => {
		expect(await keys("cafe")).toEqual([
			ids.Almuerzo,
			ids["Plain café"],
			ids["Café sealed"],
		]);
		expect(await keys("NANDU")).toEqual([
			ids["Plain Ñandú"],
			ids["Sealed Ñandú"],
		]);
		expect(await keys("nuñoa")).toEqual([ids["Sealed Ñandú"]]);
		expect(await keys("sealed")).toEqual([
			ids["Sealed Ñandú"],
			ids.Almuerzo,
			ids["Café sealed"],
		]);
	});

	it("the SQL path could not: ciphertext holds none of the words", async () => {
		const [row] = await adminDb.$queryRaw<{ n: number }[]>`
			SELECT count(*)::int AS n FROM expense
			WHERE id = ${ids["Café sealed"]} AND title ILIKE '%sealed%'`;
		expect(row?.n).toBe(0);
	});

	it("with the epoch, v1 search matches them and returns the title in the clear", async () => {
		const hits = await searchExpensesWith(adminDb, user.user.id, "CAFE", {
			after: null,
			take: 10,
		});
		expect(hits.map((h) => h.title)).toEqual([
			"Almuerzo",
			"Plain café",
			"Café sealed",
		]);
	});

	it("before the epoch the SQL path runs and sealed rows are not found", async () => {
		await writeEpoch(false);
		try {
			expect(await keys("cafe")).toEqual([ids["Plain café"]]);
			const v1 = await searchExpensesWith(adminDb, user.user.id, "cafe", {
				after: null,
				take: 5,
			});
			expect(v1.map((h) => h.title)).toEqual(["Plain café"]);
		} finally {
			await writeEpoch(true);
		}
	});

	it("fails loudly for a value sealed for another row, never skips it", async () => {
		const moved = randomUUID();
		await fixtureDb.expense.create({
			data: { ...base(user.user.id), id: moved, title: "x", date: day(20) },
		});
		// Sealed with the owner's key for another row: the AAD check refuses it.
		const ring = await userKeyring(user.user.id, master.ring as Keyring);
		await writeCell(
			"expense",
			"title",
			moved,
			sealField(ring, "Moved café", {
				table: "expense",
				column: "title",
				rowId: ids["Café sealed"] ?? "",
			}),
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(keys("cafe")).rejects.toBeInstanceOf(FieldCryptoError);
		await expect(
			searchExpensesWith(adminDb, user.user.id, "cafe", {
				after: null,
				take: 5,
			}),
		).rejects.toBeInstanceOf(FieldCryptoError);
		await adminDb.$executeRaw`DELETE FROM expense WHERE id = ${moved}`;
	});
});
