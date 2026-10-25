/**
 * GET /api/v1/search on Postgres: matches ignore case and accents, LIKE
 * wildcards in the query are literal, each group pages by its own cursor,
 * and a caller finds only what is theirs or shared with them.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Hit = { type: string; id: string; name?: string; title?: string };
type Result = {
	groups: { type: string; items: Hit[]; nextCursor: string | null }[];
};

const search = async (headers: Record<string, string>, qs: string) =>
	expectBody<Result>(
		await call(`/search?${qs}`, { headers }),
		contract.search.search,
	);
const group = (r: Result, type: string) =>
	r.groups.find((g) => g.type === type)?.items ?? [];

async function expense(userId: string, title: string, date: string) {
	return adminDb.expense.create({
		data: {
			userId,
			title,
			amount: "1234.50",
			currency: "ARS",
			date: new Date(`${date}T12:00:00Z`),
			amountInUSD: "1.00",
			exchangeRate: "1234.5",
			pricingSource: "blue",
		},
	});
}

describe("/api/v1/search", () => {
	let alice: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;
	let martin: string;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		const bob = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile(bob);

		await expense(alice, "Café con leche", "2026-10-01");
		await expense(alice, "CAFE molido", "2026-10-02");
		await expense(alice, "Cafetería Martínez", "2026-10-03");
		await expense(alice, "100% jugo", "2026-10-04");
		await expense(bob, "Café de Bob", "2026-10-05");

		// Martín shares a split with Alice; another Martín shares nothing.
		martin = (await createTestUser()).user.id;
		await adminDb.user.update({
			where: { id: martin },
			data: { name: "Martín Muñoz" },
		});
		const stranger = (await createTestUser()).user.id;
		await adminDb.user.update({
			where: { id: stranger },
			data: { name: "Martín Stranger" },
		});
		const tx = await adminDb.sharedTransaction.create({
			data: {
				description: "Asado",
				amount: "100",
				currency: "USD",
				date: new Date("2026-10-01T00:00:00Z"),
				paidByType: "user",
				paidById: alice,
				createdByType: "user",
				createdById: alice,
			},
		});
		await adminDb.splitParticipant.createMany({
			data: [
				{
					transactionId: tx.id,
					participantType: "user",
					participantId: alice,
					shareAmount: "50",
				},
				{
					transactionId: tx.id,
					participantType: "user",
					participantId: martin,
					shareAmount: "50",
				},
			],
		});
		await adminDb.shadowProfile.create({
			data: { name: "Abuela Inés", createdById: alice },
		});

		// Alice is in "Viaje a Bariloche"; Bob's public "Viaje solo" is not hers.
		const trip = await adminDb.project.create({
			data: { name: "Viaje a Bariloche", createdById: alice },
		});
		await adminDb.projectParticipant.create({
			data: {
				projectId: trip.id,
				participantType: "user",
				participantId: alice,
				role: "ORGANIZER",
			},
		});
		const solo = await adminDb.project.create({
			data: { name: "Viaje solo", createdById: bob, visibility: "PUBLIC" },
		});
		await adminDb.projectParticipant.create({
			data: {
				projectId: solo.id,
				participantType: "user",
				participantId: bob,
				role: "ORGANIZER",
			},
		});
		await adminDb.category.create({
			data: { name: "Cafés y bares", color: "amber", userId: alice },
		});
	});

	it("ignores accents and case, newest expenses first", async () => {
		const r = await search(asAlice, "q=cafe&types=expenses");
		expect(group(r, "expenses").map((h) => h.title)).toEqual([
			"Cafetería Martínez",
			"CAFE molido",
			"Café con leche",
		]);
		const accented = await search(
			asAlice,
			`q=${encodeURIComponent("CAFÉ")}&types=expenses`,
		);
		expect(group(accented, "expenses")).toHaveLength(3);
	});

	it("returns money as minor units", async () => {
		const r = await search(asAlice, "q=molido&types=expenses");
		expect(group(r, "expenses")[0]).toMatchObject({
			amount: { minor: 123_450, currency: "ARS" },
			date: "2026-10-02",
		});
	});

	it("takes LIKE wildcards literally", async () => {
		const r = await search(
			asAlice,
			`q=${encodeURIComponent("%")}&types=expenses`,
		);
		expect(group(r, "expenses").map((h) => h.title)).toEqual(["100% jugo"]);
		const underscore = await search(asAlice, "q=_&types=expenses");
		expect(group(underscore, "expenses")).toEqual([]);
	});

	it("pages one group by its cursor", async () => {
		const first = await search(asAlice, "q=caf&types=expenses&limit=2");
		const g = first.groups[0];
		expect(g?.items).toHaveLength(2);
		expect(g?.nextCursor).toBeTruthy();
		const next = await search(asAlice, `q=caf&limit=2&cursor=${g?.nextCursor}`);
		expect(next.groups.map((x) => x.type)).toEqual(["expenses"]);
		expect(next.groups[0]?.items.map((h) => h.title)).toEqual([
			"Café con leche",
		]);
		expect(next.groups[0]?.nextCursor).toBeNull();
	});

	it("finds people the caller shares money with, and their own", async () => {
		const r = await search(asAlice, "q=martin&types=people");
		expect(group(r, "people")).toEqual([
			expect.objectContaining({
				participantType: "user",
				id: martin,
				name: "Martín Muñoz",
			}),
		]);
		const shadow = await search(asAlice, "q=ines&types=people");
		expect(group(shadow, "people").map((h) => h.name)).toEqual(["Abuela Inés"]);
		const byMunoz = await search(asAlice, "q=munoz&types=people");
		expect(group(byMunoz, "people")).toHaveLength(1);
	});

	it("finds only projects and categories the caller belongs to", async () => {
		const r = await search(asAlice, "q=viaje");
		expect(r.groups.map((g) => g.type)).toEqual([
			"expenses",
			"people",
			"projects",
			"categories",
		]);
		expect(group(r, "projects").map((h) => h.name)).toEqual([
			"Viaje a Bariloche",
		]);
		const cats = await search(asAlice, "q=cafes&types=categories");
		expect(group(cats, "categories").map((h) => h.name)).toEqual([
			"Cafés y bares",
		]);
	});

	it("keeps users apart (RLS)", async () => {
		const bob = await search(asBob, "q=cafe");
		expect(group(bob, "expenses").map((h) => h.title)).toEqual(["Café de Bob"]);
		expect(group(bob, "categories")).toEqual([]);
		expect(group(bob, "people")).toEqual([]);
		const bobTrips = await search(asBob, "q=bariloche&types=projects");
		expect(group(bobTrips, "projects")).toEqual([]);
	});

	it("refuses an empty query and unknown types", async () => {
		await expectProblem(
			await call("/search?q=", { headers: asAlice }),
			400,
			"validation_failed",
		);
		await expectProblem(
			await call("/search?q=a&types=wallets", { headers: asAlice }),
			400,
			"validation_failed",
		);
	});
});
