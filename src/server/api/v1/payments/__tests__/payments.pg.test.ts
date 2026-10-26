/**
 * /api/v1/payments on Postgres: record, confirm, not received, remind and
 * undo through the web's own procedures, with previews that equal the
 * result, idempotent replay and who may do what. Fixture (ARS home, all
 * three are members of one project so each can read the others' split rows):
 * Sofia owes Martin ARS 18,000; Lucia owes Sofia ARS 20,000.
 */
import { randomUUID } from "node:crypto";
import { contract, paymentPreviewDetailSchema } from "@retrospend/api-contract";
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

const c = contract.payments;
type Money = { minor: number; currency: string };
type Preview = {
	changes: { id: string; delta: Money }[];
	unchanged: { id: string }[];
	detail?: unknown;
};
type Write = {
	id: string;
	status: string;
	allocation: { amount: Money; rows: { pays: Money }[] } | null;
	undo: string;
};
type Undone = { id: string; redo: string | null };
type PersonPage = {
	net: Money | null;
	payments: { id: string; status: string; direction: string }[];
	needs: { kind: string; id: string }[];
};

describe("/api/v1/payments", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let stranger: TestUser;
	let as: Record<string, string>;
	let asMartin: Record<string, string>;
	let asLucia: Record<string, string>;
	let asStranger: Record<string, string>;

	const post = (path: string, body: unknown, headers = as, key?: string) =>
		call(path, { method: "POST", headers, body, idempotent: key ?? true });
	const pay = (over: Record<string, unknown> = {}) => ({
		person: { type: "user", id: martin.user.id },
		direction: "outgoing",
		currency: "ARS",
		amount: "5000",
		...over,
	});
	const record = async (over: Record<string, unknown> = {}, headers = as) =>
		expectBody<Write>(
			await post("/payments", pay(over), headers),
			c.record,
			201,
		);
	const page = async (who: TestUser, headers = as) =>
		expectBody<PersonPage>(
			await call(`/people/user/${who.user.id}`, { headers }),
			contract.people.get,
		);
	const youOwe = async (headers = as) =>
		(
			await expectBody<{ youOwe: Money | null }>(
				await call("/people", { headers }),
				contract.people.list,
			)
		).youOwe?.minor ?? 0;
	const delta = (preview: Preview, id: string) =>
		preview.changes.find((x) => x.id === id)?.delta.minor ?? 0;
	const status = async (id: string) =>
		(await adminDb.payment.findUnique({ where: { id } }))?.status ?? null;

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, lucia, stranger] = [
			await arsUser(),
			await arsUser(),
			await arsUser(),
			await arsUser(),
		];
		as = await asMobile(sofia.user.id);
		asMartin = await asMobile(martin.user.id);
		asLucia = await asMobile(lucia.user.id);
		asStranger = await asMobile(stranger.user.id);
		const trip = await seedProject(sofia, [
			{ user: martin, role: "EDITOR" },
			{ user: lucia, role: "EDITOR" },
		]);
		await seedShare(ref(martin), ref(sofia), "18000", "ARS", {
			projectId: trip,
		});
		await seedShare(ref(sofia), ref(lucia), "20000", "ARS", {
			projectId: trip,
		});
	});

	it("previews a payment and records it with the same effect", async () => {
		const before = await youOwe();
		const preview = await expectBody<Preview>(
			await post("/payments/preview", pay()),
			c.previewRecord,
		);
		expect(delta(preview, "owed.youOwe")).toBe(-500_000);
		expect(await youOwe()).toBe(before);
		await expect(
			adminDb.payment.count({ where: { payerId: sofia.user.id } }),
		).resolves.toBe(0);

		const written = await record();
		expect(written.status).toBe("PROPOSED");
		expect(written.allocation?.amount).toEqual(ars(500_000));
		expect(written.allocation?.rows).toHaveLength(1);
		// The preview says what the write then does: the same allocation.
		expect(paymentPreviewDetailSchema.parse(preview.detail)).toEqual({
			kind: "payment.record",
			allocation: written.allocation,
		});
		expect(await youOwe()).toBe(before + delta(preview, "owed.youOwe"));
		await expect(status(written.id)).resolves.toBe("PROPOSED");
	});

	it("records once per idempotency key", async () => {
		const key = randomUUID();
		const first = await post("/payments", pay({ amount: "100" }), as, key);
		const again = await post("/payments", pay({ amount: "100" }), as, key);
		expect(again.headers.get("idempotent-replayed")).toBe("true");
		expect(await again.json()).toEqual(await first.json());
		await expect(
			adminDb.payment.count({
				where: { payerId: sofia.user.id, amount: "100" },
			}),
		).resolves.toBe(1);
	});

	it("refuses an amount with more decimals than the currency has", async () => {
		await expectProblem(
			await post("/payments/preview", pay({ amount: "400.005" })),
			400,
			"bad_request",
		);
		await expectProblem(
			await post("/payments", pay({ amount: "400.005" })),
			400,
			"bad_request",
		);
		const sent = await record({ amount: "400.5" });
		await expectProblem(
			await post(
				`/payments/${sent.id}/confirm`,
				{ id: sent.id, amount: "1.005" },
				asMartin,
			),
			400,
			"bad_request",
		);
		await expectBody(
			await post("/payments/undo", { token: sent.undo }),
			c.undo,
		);
	});

	it("uses a client-made id once", async () => {
		const id = randomUUID();
		const made = await record({ id, amount: "50" });
		expect(made.id).toBe(id);
		await expectProblem(
			await post("/payments", pay({ id, amount: "50" })),
			409,
			"id_taken",
		);
		await expectBody(
			await post("/payments/undo", { token: made.undo }),
			c.undo,
		);
	});

	it("lets the person it waits for confirm it, and undo and redo the confirm", async () => {
		const sent = await record({ amount: "2000" });
		const seen = await page(sofia, asMartin);
		expect(
			seen.needs.some((n) => n.kind === "confirmPayment" && n.id === sent.id),
		).toBe(true);

		const confirm = { id: sent.id };
		const preview = await expectBody<Preview>(
			await post(`/payments/${sent.id}/confirm/preview`, confirm, asMartin),
			c.previewConfirm,
		);
		const beforeNet = (await page(sofia, asMartin)).net?.minor ?? 0;
		const confirmed = await expectBody<{ id: string; undo: string }>(
			await post(`/payments/${sent.id}/confirm`, confirm, asMartin),
			c.confirm,
		);
		await expect(status(sent.id)).resolves.toBe("FINALIZED");
		expect((await page(sofia, asMartin)).net?.minor).toBe(
			beforeNet + delta(preview, "balance.person"),
		);

		const undone = await expectBody<Undone>(
			await post("/payments/undo", { token: confirmed.undo }, asMartin),
			c.undo,
		);
		await expect(status(sent.id)).resolves.toBe("PROPOSED");
		await expectBody(
			await post("/payments/undo", { token: undone.redo }, asMartin),
			c.undo,
		);
		await expect(status(sent.id)).resolves.toBe("FINALIZED");
		// The first token is spent: using it again would unconfirm what was
		// just confirmed again.
		await expectProblem(
			await post("/payments/undo", { token: confirmed.undo }, asMartin),
			409,
			"conflict",
		);
		await expect(status(sent.id)).resolves.toBe("FINALIZED");
	});

	it("says a payment never came, with a preview", async () => {
		const sent = await record({ amount: "3000" });
		const path = `/payments/${sent.id}/not-received`;
		const preview = await expectBody<Preview>(
			await post(`${path}/preview`, { id: sent.id }, asMartin),
			c.previewNotReceived,
		);
		// A payment that waits for you is not in your figures yet, so rejecting
		// it moves none of yours; it gives the payer their debt back.
		expect(preview.changes.filter((x) => x.id.startsWith("owed."))).toEqual([]);
		expect(preview.unchanged.map((x) => x.id)).toContain("owed.owedToYou");
		// Only home-currency balances went into it: not an estimate, so not marked.
		expect(
			preview.unchanged.find((x) => x.id === "owed.owedToYou"),
		).not.toHaveProperty("approx");
		const payerBefore = await youOwe();
		await expect(status(sent.id)).resolves.toBe("PROPOSED");
		const rejected = await expectBody<{ status: string }>(
			await post(path, { id: sent.id, reason: "Nothing arrived" }, asMartin),
			c.notReceived,
		);
		expect(rejected.status).toBe("REJECTED");
		await expect(status(sent.id)).resolves.toBe("REJECTED");
		expect(await youOwe()).toBe(payerBefore + 300_000);
		await expectProblem(
			await post(path, { id: sent.id }, asMartin),
			400,
			"bad_request",
		);
	});

	it("marks owed totals as estimates only when another currency went into them", async () => {
		const [creditor, debtor] = [await arsUser(), await arsUser()];
		const asDebtor = await asMobile(debtor.user.id);
		const owedLines = (preview: Preview) =>
			[...preview.changes, ...preview.unchanged].filter((x) =>
				x.id.startsWith("owed."),
			);
		const body = (currency: string) => ({
			person: { type: "user", id: creditor.user.id },
			direction: "outgoing",
			currency,
			amount: "10",
		});

		// A debt in the home currency (ARS): nothing is converted.
		await seedShare(ref(creditor), ref(debtor), "500", "ARS");
		const plain = await expectBody<Preview>(
			await post("/payments/preview", body("ARS"), asDebtor),
			c.previewRecord,
		);
		expect(owedLines(plain).length).toBeGreaterThan(0);
		for (const line of owedLines(plain)) expect(line).not.toHaveProperty("approx");

		// A debt in BRL is converted into ARS for the total: an estimate.
		await seedShare(ref(creditor), ref(debtor), "50", "BRL");
		const converted = await expectBody<Preview>(
			await post("/payments/preview", body("BRL"), asDebtor),
			c.previewRecord,
		);
		expect(owedLines(converted).length).toBeGreaterThan(0);
		for (const line of owedLines(converted))
			expect(line).toMatchObject({ approx: true });
		// The figures of a payment with that person are never estimates.
		expect(
			converted.changes.find((x) => x.id === "balance.person"),
		).not.toHaveProperty("approx");
	});

	it("takes back a payment you recorded, with a preview", async () => {
		const sent = await record({ amount: "700" });
		const before = await youOwe();
		const preview = await expectBody<Preview>(
			await post("/payments/undo/preview", { token: sent.undo }),
			c.previewUndo,
		);
		await expect(status(sent.id)).resolves.toBe("PROPOSED");
		const undone = await expectBody<Undone>(
			await post("/payments/undo", { token: sent.undo }),
			c.undo,
		);
		expect(undone).toMatchObject({ id: sent.id, redo: null });
		await expect(status(sent.id)).resolves.toBeNull();
		expect(await youOwe()).toBe(before + delta(preview, "owed.youOwe"));
	});

	it("records money received as final at once, and voids it on undo", async () => {
		const got = await record(
			{
				person: { type: "user", id: lucia.user.id },
				direction: "incoming",
				amount: "8000",
			},
			as,
		);
		expect(got.status).toBe("FINALIZED");
		expect((await page(lucia)).net?.minor).toBe(1_200_000);
		await expectBody(await post("/payments/undo", { token: got.undo }), c.undo);
		expect((await page(lucia)).net?.minor).toBe(2_000_000);
	});

	it("refuses a typed rate far from the stored one, in the preview too", async () => {
		// Sofia pays USD 5 against her ARS 18,000, at the rate she typed. ARS is 1355
		// per USD (blue) or less, so a USD per ARS between about 0.00015 and 0.005 is
		// plausible; 0.000001 would clear ARS 5,000,000 for USD 5.
		const typed = (rate: string) =>
			pay({
				currency: "USD",
				amount: "5",
				customRate: { rate, currency: "ARS" },
			});
		const slip = typed("0.000001");
		await expectProblem(
			await post("/payments/preview", slip),
			422,
			"rate_out_of_range",
		);
		await expectProblem(await post("/payments", slip), 422, "rate_out_of_range");
		const fine = await expectBody<Write>(
			await post("/payments", typed("0.0007")),
			c.record,
			201,
		);
		await expectBody(
			await post("/payments/undo", { token: fine.undo }),
			c.undo,
		);
	});

	it("refuses more than is owed unless allowed, in the preview too", async () => {
		const over = pay({
			person: { type: "user", id: lucia.user.id },
			direction: "incoming",
			amount: "25000",
		});
		await expectProblem(await post("/payments/preview", over), 422, "overpay");
		await expectProblem(await post("/payments", over), 422, "overpay");
		const allowed = await expectBody<Write>(
			await post("/payments", { ...over, allowOverpay: true }),
			c.record,
			201,
		);
		expect(allowed.status).toBe("FINALIZED");
		await expectBody(
			await post("/payments/undo", { token: allowed.undo }),
			c.undo,
		);
	});

	it("keeps a payment to the two people in it", async () => {
		const sent = await record({ amount: "400" });
		for (const headers of [asLucia, asStranger]) {
			await expectProblem(
				await post(`/payments/${sent.id}/confirm`, { id: sent.id }, headers),
				404,
				"not_found",
			);
			await expectProblem(
				await post(
					`/payments/${sent.id}/confirm/preview`,
					{ id: sent.id },
					headers,
				),
				404,
				"not_found",
			);
			await expectProblem(
				await post(
					`/payments/${sent.id}/not-received`,
					{ id: sent.id },
					headers,
				),
				404,
				"not_found",
			);
			await expectProblem(
				await post("/payments/undo", { token: sent.undo }, headers),
				400,
				"bad_request",
			);
		}
		await expectProblem(
			await post(
				"/payments",
				pay({ person: { type: "user", id: stranger.user.id } }),
			),
			404,
			"not_found",
		);
		// A project member who is not in the payment sees its rows (RLS), so the
		// reminder says who may send it; someone outside the project sees nothing.
		await expectProblem(
			await post(`/payments/${sent.id}/remind`, {}, asLucia),
			403,
			"forbidden",
		);
		await expectProblem(
			await post(`/payments/${sent.id}/remind`, {}, asStranger),
			404,
			"not_found",
		);
		// The payer cannot confirm their own payment.
		await expectProblem(
			await post(`/payments/${sent.id}/confirm`, { id: sent.id }),
			403,
			"forbidden",
		);
		await expect(status(sent.id)).resolves.toBe("PROPOSED");
	});

	it("lets the payer remind once a day", async () => {
		const sent = await record({ amount: "300" });
		await expectBody(await post(`/payments/${sent.id}/remind`, {}), c.remind);
		await expectProblem(
			await post(`/payments/${sent.id}/remind`, {}),
			409,
			"conflict",
		);
		await expectProblem(
			await post(`/payments/${sent.id}/remind`, {}, asMartin),
			403,
			"forbidden",
		);
	});

	it("needs write:money, and write:expenses only for the reminder", async () => {
		const expensesOnly = await asKey(sofia.user.id, ["write:expenses"]);
		await expectProblem(
			await post("/payments", pay(), expensesOnly),
			403,
			"missing_scope",
		);
		await expectProblem(
			await post("/payments/preview", pay(), expensesOnly),
			403,
			"missing_scope",
		);
		await expectProblem(
			await post("/payments", pay({ amount: 5 }), as),
			400,
			"validation_failed",
		);
	});
});
