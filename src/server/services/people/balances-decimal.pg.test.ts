/**
 * People balances on exact decimals, on real Postgres (RLS on): the People
 * page, the Person page and the project's perspective cards in an ARS home
 * (blue, 1 USD = 1545) and a JPY home (1 USD = 150), with every number
 * worked out by hand.
 *
 * Fixture, ARS home (Sofía), project Cabaña:
 *   Sofía paid USD 10.01, Martín owes all of it.
 *   Martín paid ARS 15,000, split 7,500 each, so Sofía owes him ARS 7,500.
 * Martín is owed and owing at once, in two currencies: two figures, never one.
 * Outside the project, Lucía paid ARS 0.57 and Sofía's share is the legacy
 * 8 dp row 0.285 (28.5 centavos, a tie): half even gives 28.
 * JPY home (Kenji): Aiko owes him USD 10.01 = JPY 1501.5, a tie that half
 * even takes to 1502, and Beni owes CHF 5.00, a currency with no rate.
 */
import { toMinorUnits } from "@retrospend/domain/money";
import { dayKey } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { figures, readFiguresIn } from "~/server/figures/registry";
import { personKey } from "~/server/services/payments/view";
import { projectBalancesFromPerspective } from "~/server/services/project/group.service";
import { PeopleService } from "~/server/services/shared-expenses/people.service";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { personPage } from "./detail";
import { peopleOverview } from "./overview";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});
const money = (minor: number, currency: string) => ({ minor, currency });

async function seedRates() {
	for (const [currency, type, rate] of [
		["ARS", "blue", "1545"],
		["JPY", "official", "150"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: today, currency, type } },
			create: { date: today, currency, type, rate },
			update: { rate },
		});
	}
}

interface Share {
	who: ParticipantRef;
	amount: string;
}

/** `payer` paid `amount`; `shares` is exactly what each person owes. */
async function seedTx(
	payer: ParticipantRef,
	amount: string,
	currency: string,
	shares: Share[],
	projectId: string | null = null,
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount,
			currency,
			date: new Date("2026-10-08"),
			paidByType: payer.participantType,
			paidById: payer.participantId,
			createdByType: payer.participantType,
			createdById: payer.participantId,
			projectId,
			splitParticipants: {
				create: shares.map((s) => ({
					...s.who,
					shareAmount: s.amount,
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
}

async function project(owner: TestUser, members: ParticipantRef[]) {
	const created = await adminDb.project.create({
		data: { name: "Cabaña", createdById: owner.user.id, primaryCurrency: "ARS" },
	});
	for (const m of members) {
		await adminDb.projectParticipant.create({
			data: { projectId: created.id, ...m, role: "EDITOR" },
		});
	}
	return created.id;
}

async function setHome(users: TestUser[], homeCurrency: string) {
	for (const u of users)
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency },
		});
}

async function balancePerson(
	u: TestUser,
	person: ParticipantRef,
	projectId?: string,
) {
	const map = await userTransaction(adminDb, u.user.id, (tx) =>
		readFiguresIn(tx, [figures.get("balance.person")], {
			userId: u.user.id,
			personId: personKey(person),
			...(projectId ? { projectId } : {}),
		}),
	);
	return [...(map.get("balance.person") ?? [])].sort((a, b) =>
		a.currency < b.currency ? -1 : 1,
	);
}

let sofia: TestUser;
let martin: TestUser;
let lucia: TestUser;
let kenji: TestUser;
let aiko: TestUser;
let beni: TestUser;
let cabana: string;

beforeAll(async () => {
	await seedRates();
	sofia = await createTestUser();
	martin = await createTestUser();
	lucia = await createTestUser();
	kenji = await createTestUser();
	aiko = await createTestUser();
	beni = await createTestUser();
	await setHome([sofia, martin, lucia], "ARS");
	await setHome([kenji, aiko, beni], "JPY");
	cabana = await project(sofia, [ref(sofia), ref(martin)]);
	await seedTx(
		ref(sofia),
		"10.01",
		"USD",
		[
			{ who: ref(martin), amount: "10.01" },
			{ who: ref(sofia), amount: "0" },
		],
		cabana,
	);
	await seedTx(
		ref(martin),
		"15000",
		"ARS",
		[
			{ who: ref(sofia), amount: "7500" },
			{ who: ref(martin), amount: "7500" },
		],
		cabana,
	);
	await seedTx(ref(lucia), "0.57", "ARS", [
		{ who: ref(sofia), amount: "0.285" },
		{ who: ref(lucia), amount: "0.285" },
	]);
	await seedTx(ref(kenji), "10.01", "USD", [
		{ who: ref(aiko), amount: "10.01" },
		{ who: ref(kenji), amount: "0" },
	]);
	await seedTx(ref(kenji), "5", "CHF", [
		{ who: ref(beni), amount: "5" },
		{ who: ref(kenji), amount: "0" },
	]);
});

describe("a person owed and owing in two currencies", () => {
	it("stays two figures on the registered balance", async () => {
		// Martín owes USD 10.01 and is owed ARS 7,500: ARS -750000 and USD +1001.
		const expected = [money(-750_000, "ARS"), money(1001, "USD")];
		expect(await balancePerson(sofia, ref(martin))).toEqual(expected);
		expect(await balancePerson(sofia, ref(martin), cabana)).toEqual(expected);
		expect(await balancePerson(martin, ref(sofia))).toEqual([
			money(750_000, "ARS"),
			money(-1001, "USD"),
		]);
	});

	it("keeps Owed to you and You owe apart on the project's perspective card", async () => {
		const view = await projectBalancesFromPerspective(
			sofia.db,
			cabana,
			ref(sofia),
			ref(sofia),
		);
		const card = view.statements.find(
			(s) => s.counterpart.participantId === martin.user.id,
		);
		expect(card?.netByCurrency).toEqual({ ARS: -7500, USD: 10.01 });
		expect(view.totals.owedToPerspective).toEqual({ USD: 10.01 });
		expect(view.totals.owedByPerspective).toEqual({ ARS: 7500 });
	});

	it("shows both on the Person page with the ARS blue value of the USD part", async () => {
		const page = await personPage(sofia.db, sofia.user.id, ref(martin));
		// 10.01 x 1545 = 15465.45 ARS (1546545 minor); net 15465.45 - 7500.
		expect(page.parts.map((p) => [p.amount, p.home])).toEqual([
			[money(-750_000, "ARS"), money(-750_000, "ARS")],
			[money(1001, "USD"), money(1_546_545, "ARS")],
		]);
		expect(page.parts[1]?.rate).toMatchObject({ type: "blue", rate: "1545" });
		expect(page.net).toEqual(money(796_545, "ARS"));
	});

	it("puts the net on the People page and still counts Lucía's tie as 28 centavos", async () => {
		const view = await peopleOverview(sofia.db, sofia.user.id);
		const by = new Map(view.people.map((p) => [p.person.id, p]));
		expect(by.get(martin.user.id)?.net).toEqual(money(796_545, "ARS"));
		expect(by.get(martin.user.id)?.group).toBe("owed");
		// 0.285 ARS is 28.5 centavos: half even gives 28 (half up would be 29).
		expect(by.get(lucia.user.id)?.net).toEqual(money(-28, "ARS"));
		expect(view.owedToYou).toEqual(money(796_545, "ARS"));
		expect(view.youOwe).toEqual(money(28, "ARS"));
	});

	it("shows the same 0.28 on the people list, read from the same sums", async () => {
		const list = await new PeopleService(sofia.db, ref(sofia)).listPeople();
		const item = list.find(
			(p) => p.identity.participantId === lucia.user.id,
		);
		expect(item?.balances).toEqual([
			{ balance: 0.28, currency: "ARS", direction: "you_owe_them" },
		]);
		expect(await balancePerson(sofia, ref(lucia))).toEqual([
			money(-28, "ARS"),
		]);
	});
});

describe("a JPY home", () => {
	it("values USD 10.01 at 150 as JPY 1501.5 and takes the tie to the even 1502", async () => {
		const page = await personPage(kenji.db, kenji.user.id, ref(aiko));
		expect(page.parts).toHaveLength(1);
		expect(page.parts[0]?.amount).toEqual(money(1001, "USD"));
		expect(page.parts[0]?.home).toEqual(money(1502, "JPY"));
		expect(page.parts[0]?.rate).toMatchObject({ type: "official", rate: "150" });
		expect(page.net).toEqual(money(1502, "JPY"));
	});

	it("never turns a missing rate into 1: CHF has none, so its home value and the totals are null", async () => {
		const page = await personPage(kenji.db, kenji.user.id, ref(beni));
		expect(page.parts).toEqual([
			{ amount: money(500, "CHF"), home: null, rate: null },
		]);
		expect(page.net).toBeNull();
		const view = await peopleOverview(kenji.db, kenji.user.id);
		expect(view.owedToYou).toBeNull();
		expect(view.unpriced).toEqual(["CHF"]);
	});
});

describe("the project's perspective cards read the registered balance", () => {
	/** A small seeded generator, so the fixture is the same on every run. */
	const random = (seed: number) => () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	it("equals balance.person for every counterpart, pending claims included", async () => {
		const owner = await createTestUser();
		const others = await Promise.all([createTestUser(), createTestUser()]);
		const paz: ParticipantRef = {
			participantType: "shadow",
			participantId: (
				await adminDb.shadowProfile.create({
					data: { createdById: owner.user.id, name: "Paz" },
				})
			).id,
		};
		const people = [ref(owner), ...others.map(ref), paz];
		const id = await project(owner, people);
		const next = random(5);
		const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
		const cents = (n: number) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;

		for (let i = 0; i < 30; i++) {
			const payer = pick(people);
			const currency = pick(["ARS", "USD"]);
			const size = 2 + Math.floor(next() * 3);
			const who = [...people].sort(() => next() - 0.5).slice(0, size);
			if (i % 4 === 0) {
				// A legacy row: 100.00 over three at 33.33333333 (sums to 99.99999999).
				await seedTx(
					payer,
					"100.00",
					currency,
					people.slice(0, 3).map((w) => ({ who: w, amount: "33.33333333" })),
					id,
				);
				continue;
			}
			const total = 1000 + Math.floor(next() * 500_000);
			const base = Math.floor(total / size);
			await seedTx(
				payer,
				cents(total),
				currency,
				who.map((w, k) => ({
					who: w,
					amount: cents(k === 0 ? base + (total - base * size) : base),
				})),
				id,
			);
		}

		const settle = (
			from: ParticipantRef,
			to: ParticipantRef,
			amount: string,
			currency: string,
			status: "FINALIZED" | "PROPOSED",
			confirmedByPayer: boolean,
		) =>
			adminDb.settlement.create({
				data: {
					fromParticipantType: from.participantType,
					fromParticipantId: from.participantId,
					toParticipantType: to.participantType,
					toParticipantId: to.participantId,
					amount,
					currency,
					status,
					confirmedByPayer,
					projectId: id,
				},
			});
		const [a, b] = others.map(ref) as [ParticipantRef, ParticipantRef];
		await settle(a, ref(owner), "100.00", "ARS", "FINALIZED", true);
		// The owner's own pending payment counts for the owner.
		await settle(ref(owner), b, "5.00", "USD", "PROPOSED", true);
		// Their pending claim does not count for the owner until confirmed.
		await settle(b, ref(owner), "50.00", "ARS", "PROPOSED", true);
		await settle(paz, ref(owner), "20.00", "ARS", "FINALIZED", true);

		const view = await projectBalancesFromPerspective(
			owner.db,
			id,
			ref(owner),
			ref(owner),
		);
		const owedTo: Record<string, number> = {};
		const owedBy: Record<string, number> = {};
		for (const card of view.statements) {
			const figure = await balancePerson(owner, {
				participantType: card.counterpart.participantType,
				participantId: card.counterpart.participantId,
			}, id);
			const shown = Object.entries(card.netByCurrency)
				.map(([c, v]) => money(toMinorUnits(v, c), c))
				.sort((x, y) => (x.currency < y.currency ? -1 : 1));
			expect(shown).toEqual(figure.filter((m) => m.minor !== 0));
			for (const m of figure) {
				const into = m.minor > 0 ? owedTo : owedBy;
				into[m.currency] = (into[m.currency] ?? 0) + Math.abs(m.minor);
			}
		}
		const minors = (r: Record<string, number>) =>
			Object.fromEntries(
				Object.entries(r).map(([c, v]) => [c, toMinorUnits(v, c)]),
			);
		expect(minors(view.totals.owedToPerspective)).toEqual(owedTo);
		expect(minors(view.totals.owedByPerspective)).toEqual(owedBy);
		expect(view.statements.length).toBeGreaterThan(0);
	});
});
