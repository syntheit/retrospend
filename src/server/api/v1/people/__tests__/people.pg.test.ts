/**
 * /api/v1/people on Postgres: the People list and Person page the web reads,
 * the cursor ledger, adding and renaming a person, the claim link, reminders
 * and the Settle up read. Fixture (ARS home): Sofia owes Martin ARS 18,000
 * outside projects and ARS 1,000 in Trip; Paz (no account) owes Sofia ARS
 * 80,000. Cross-user: Martin cannot see or touch the person Sofia added. The
 * Trip share is what makes Martin visible in Sofia's list: someone else's
 * split row is readable only inside a project (RLS on split_participant).
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	ars,
	arsUser,
	ref,
	seedProject,
	seedRates,
	seedShare,
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

const c = contract.people;
type Money = { minor: number; currency: string };
type Overview = {
	owedToYou: Money | null;
	youOwe: Money | null;
	people: {
		person: { id: string; type: string; name: string };
		group: string;
		net: Money | null;
	}[];
};
type Page = {
	person: { name: string };
	net: Money | null;
	rowCount: number;
	rows: { id: string; effect: Money | null; state: string; paidBy: string }[];
	scopes: { project: unknown; lines: Money[]; settledSince: string | null }[];
};
type Ledger = {
	items: { id: string; title: string }[];
	nextCursor: string | null;
};
type Sheet = {
	suggested: string | null;
	everything: Money | null;
	lines: { project: unknown; amount: Money }[];
};

describe("/api/v1/people", () => {
	useApiV1();
	let sofia: TestUser;
	let martin: TestUser;
	let as: Record<string, string>;
	let asMartin: Record<string, string>;
	let paz: string;
	let trip: string;

	const get = (path: string, headers = as) => call(path, { headers });
	const post = (path: string, body: unknown, headers = as, key?: string) =>
		call(path, { method: "POST", headers, body, idempotent: key ?? true });

	beforeAll(async () => {
		await seedRates();
		sofia = await arsUser();
		martin = await arsUser();
		as = await asMobile(sofia.user.id);
		asMartin = await asMobile(martin.user.id);
		trip = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
		await seedShare(ref(martin), ref(sofia), "18000", "ARS", {
			title: "Dinner",
			date: "2026-10-08",
		});
		await seedShare(ref(martin), ref(sofia), "1000", "ARS", {
			title: "Taxi",
			date: "2026-10-09",
			projectId: trip,
		});
		const created = await expectBody<{ id: string }>(
			await post("/people", { name: "Paz" }),
			c.create,
			201,
		);
		paz = created.id;
		await seedShare(
			ref(sofia),
			{ participantType: "shadow", participantId: paz },
			"80000",
			"ARS",
		);
	});

	it("lists people with Owed to you and You owe apart", async () => {
		const list = await expectBody<Overview>(await get("/people"), c.list);
		expect(list.owedToYou).toEqual(ars(8_000_000));
		expect(list.youOwe).toEqual(ars(1_900_000));
		const paza = list.people.find((p) => p.person.id === paz);
		expect(paza).toMatchObject({ group: "owed", net: ars(8_000_000) });
		const marti = list.people.find((p) => p.person.id === martin.user.id);
		expect(marti).toMatchObject({ group: "owe", net: ars(-1_900_000) });
	});

	it("reads one person: balance, projects and the newest rows", async () => {
		const page = await expectBody<Page>(
			await get(`/people/user/${martin.user.id}`),
			c.get,
		);
		expect(page.net).toEqual(ars(-1_900_000));
		expect(page.rowCount).toBe(2);
		expect(page.rows[0]).toMatchObject({
			paidBy: "them",
			effect: ars(-100_000),
			state: "ok",
		});
		expect(page.scopes).toEqual([
			{
				project: { id: trip, name: "Trip" },
				lines: [ars(-100_000)],
				settledSince: null,
			},
			{ project: null, lines: [ars(-1_800_000)], settledSince: null },
		]);
	});

	it("pages the shared expenses with a cursor, newest first", async () => {
		for (const [i, title] of ["Mar", "Apr", "May", "Jun"].entries()) {
			await seedShare(ref(martin), ref(sofia), "10", "ARS", {
				title,
				date: `2026-0${i + 3}-15`,
			});
		}
		const path = `/people/user/${martin.user.id}/ledger`;
		const first = await expectBody<Ledger>(
			await get(`${path}?limit=2`),
			c.ledger,
		);
		expect(first.items.map((r) => r.title)).toEqual(["Taxi", "Dinner"]);
		const second = await expectBody<Ledger>(
			await get(`${path}?limit=2&cursor=${first.nextCursor}`),
			c.ledger,
		);
		expect(second.items.map((r) => r.title)).toEqual(["Jun", "May"]);
		const third = await expectBody<Ledger>(
			await get(`${path}?limit=2&cursor=${second.nextCursor}`),
			c.ledger,
		);
		expect(third.items.map((r) => r.title)).toEqual(["Apr", "Mar"]);
		expect(third.nextCursor).toBeNull();
		await expectProblem(
			await get(`${path}?cursor=not-a-cursor`),
			400,
			"bad_request",
		);
	});

	it("does not lose rows that share a date across pages", async () => {
		const [a, b] = [await arsUser(), await arsUser()];
		await seedProject(a, [{ user: b, role: "EDITOR" }]);
		for (const title of ["one", "two", "three", "four", "five"])
			await seedShare(ref(b), ref(a), "10", "ARS", {
				title,
				date: "2026-09-01",
			});
		const headers = await asMobile(a.user.id);
		const seen: string[] = [];
		let cursor: string | null = null;
		for (let pages = 0; pages < 10; pages++) {
			const q: string = cursor ? `&cursor=${cursor}` : "";
			const page: Ledger = await expectBody<Ledger>(
				await get(`/people/user/${b.user.id}/ledger?limit=2${q}`, headers),
				c.ledger,
			);
			seen.push(...page.items.map((r) => r.title));
			cursor = page.nextCursor;
			if (!cursor) break;
		}
		expect(seen.sort()).toEqual(["five", "four", "one", "three", "two"]);
	});

	it("keeps a person you added to you", async () => {
		await expectProblem(
			await get(`/people/shadow/${paz}`, asMartin),
			404,
			"not_found",
		);
		await expectProblem(
			await call(`/people/shadow/${paz}`, {
				method: "PATCH",
				headers: asMartin,
				body: { name: "Not Paz" },
				idempotent: true,
			}),
			404,
			"not_found",
		);
		await expectProblem(
			await post(`/people/shadow/${paz}/claim-link`, {}, asMartin),
			404,
			"not_found",
		);
	});

	it("adds a person once per idempotency key, and answers an account for its email", async () => {
		const key = randomUUID();
		const first = await post("/people", { name: "Dani" }, as, key);
		const again = await post("/people", { name: "Dani" }, as, key);
		expect(again.headers.get("idempotent-replayed")).toBe("true");
		expect(await again.json()).toEqual(await first.json());
		await expect(
			adminDb.shadowProfile.count({
				where: { createdById: sofia.user.id, name: "Dani" },
			}),
		).resolves.toBe(1);

		const existing = await expectBody<{
			type: string;
			id: string;
			existing: boolean;
		}>(
			await post("/people", { name: "Marty", email: martin.user.email }),
			c.create,
			201,
		);
		expect(existing).toMatchObject({
			type: "user",
			id: martin.user.id,
			existing: true,
		});
		await expect(
			adminDb.shadowProfile.count({ where: { name: "Marty" } }),
		).resolves.toBe(0);
	});

	it("does not tell whether an email belongs to an account you have no connection with", async () => {
		const stranger = await arsUser();
		const id = randomUUID();
		const typed = stranger.user.email.toUpperCase();
		const known = await expectBody<Record<string, unknown>>(
			await post("/people", { id, name: "Sam", email: typed }),
			c.create,
			201,
		);
		const unknown = await expectBody<Record<string, unknown>>(
			await post("/people", { name: "Sam", email: "nobody@pg-test.invalid" }),
			c.create,
			201,
		);
		// Same shape, a person with the typed email, never the account's id or name.
		expect(known).toEqual({
			type: "shadow",
			id,
			name: "Sam",
			email: typed,
			existing: false,
		});
		expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
		expect(unknown.type).toBe("shadow");
		expect(known.id).not.toBe(stranger.user.id);
		await expect(
			adminDb.shadowProfile.findUnique({ where: { id } }),
		).resolves.toMatchObject({
			createdById: sofia.user.id,
			email: typed,
		});
		// A client id is used once.
		await expectProblem(
			await post("/people", { id, name: "Sam again" }),
			409,
			"conflict",
		);
	});

	it("answers the payer's account to the debtor who adds them by email", async () => {
		// No project: the debtor cannot read the payer's split row, only the expense.
		const [debtor, payer] = [await arsUser(), await arsUser()];
		await seedShare(ref(payer), ref(debtor), "10", "ARS");
		const out = await expectBody<{
			type: string;
			id: string;
			existing: boolean;
		}>(
			await post(
				"/people",
				{ name: "Pay", email: payer.user.email },
				await asMobile(debtor.user.id),
			),
			c.create,
			201,
		);
		expect(out).toMatchObject({
			type: "user",
			id: payer.user.id,
			existing: true,
		});
		await expect(
			adminDb.shadowProfile.count({ where: { createdById: debtor.user.id } }),
		).resolves.toBe(0);
	});

	it("meters adding a person with an email", async () => {
		const [spammer] = [await arsUser()];
		const headers = await asMobile(spammer.user.id);
		const add = (i: number) =>
			post("/people", { name: "P", email: `p${i}@pg-test.invalid` }, headers);
		for (let i = 0; i < 20; i++) expect((await add(i)).status).toBe(201);
		const limited = await add(20);
		await expectProblem(limited, 429, "rate_limited");
		expect(limited.headers.get("retry-after")).toBeTruthy();
		// Without an email there is nothing to look up.
		const plain = await post("/people", { name: "Plain" }, headers);
		expect(plain.status).toBe(201);
	});

	it("renames a person you added", async () => {
		const renamed = await expectBody<{ name: string }>(
			await call(`/people/shadow/${paz}`, {
				method: "PATCH",
				headers: as,
				body: { name: "Paz Gomez" },
				idempotent: true,
			}),
			c.rename,
		);
		expect(renamed.name).toBe("Paz Gomez");
		const page = await expectBody<Page>(
			await get(`/people/shadow/${paz}`),
			c.get,
		);
		expect(page.person.name).toBe("Paz Gomez");
	});

	it("makes a claim link that is shown once", async () => {
		const key = randomUUID();
		const link = await expectBody<{ url: string; token: string }>(
			await post(`/people/shadow/${paz}/claim-link`, {}, as, key),
			c.claimLink,
		);
		expect(link.url).toContain(`/claim/${link.token}`);
		await expectProblem(
			await post(`/people/shadow/${paz}/claim-link`, {}, as, key),
			409,
			"idempotency_replay_unavailable",
		);
	});

	it("reminds a person on Retrospend once a day, and not one without an account", async () => {
		await expectProblem(
			await post(`/people/shadow/${paz}/remind`, {}),
			400,
			"bad_request",
		);
		await expectBody(
			await post(`/people/user/${martin.user.id}/remind`, {}),
			c.remind,
		);
		await expectProblem(
			await post(`/people/user/${martin.user.id}/remind`, {}),
			409,
			"conflict",
		);
	});

	it("reads what the Settle up sheet needs", async () => {
		const path = `/people/user/${martin.user.id}/settle`;
		const sheet = await expectBody<Sheet>(await get(path), c.settle);
		expect(sheet.suggested).toBe("outgoing");
		expect(sheet.everything).toEqual(ars(1_904_000));
		const outside = await expectBody<Sheet>(
			await get(`${path}?scope=outside`),
			c.settle,
		);
		expect(outside.lines).toEqual([{ project: null, amount: ars(-1_804_000) }]);
		await expectProblem(
			await get(`${path}?direction=sideways`),
			400,
			"validation_failed",
		);
	});
});
