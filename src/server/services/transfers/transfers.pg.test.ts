/**
 * Moves between your own places on real Postgres, through the preview runner
 * and RLS (MONEY-MOVES §2.3 to §2.7, §3). ARS home; rates ARS 1,468 Blue,
 * 1,412 Official per USD. Every test opens its own accounts (ten days old):
 * Savings ARS 5,000,000 and Digital wallet ARS 1,000,000 (in the budget),
 * Credit card owing ARS 842,600 (in), Personal loan owing ARS 2,000,000
 * (out), USD cash at Blue and Wise at Official, both USD and out.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { dec } from "~/server/services/envelope/units";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { closeAccount } from "../accounts/manage";
import {
	arsUser,
	balanceOf,
	daysAgo,
	openAccount,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { type CreateTransferInput, createTransfer } from "./create.mutation";
import { deleteTransfer } from "./delete.mutation";

beforeAll(seedArsRates);

async function places() {
	const { user, db } = await arsUser();
	const id = user.id;
	return {
		userId: id,
		db,
		savings: await openAccount(id, "Savings", "CASH", "ARS", 5_000_000),
		wallet: await openAccount(id, "Digital wallet", "CASH", "ARS", 1_000_000),
		card: await openAccount(
			id,
			"Credit card",
			"LIABILITY_CREDIT_CARD",
			"ARS",
			842_600,
		),
		loan: await openAccount(
			id,
			"Personal loan",
			"LIABILITY_LOAN",
			"ARS",
			2_000_000,
		),
		usdCash: await openAccount(id, "USD cash", "CASH", "USD", 0, {
			exchangeRateType: "blue",
		}),
		wise: await openAccount(id, "Wise", "INVESTMENT", "USD", 1840.55, {
			exchangeRateType: "official",
		}),
	};
}

type Places = Awaited<ReturnType<typeof places>>;

const move = (p: Places, input: CreateTransferInput) =>
	forUser(p.userId).apply(createTransfer, input);
const ARS = (minor: number) => ({ minor, currency: "ARS" });
const delta = (
	result: { changes: readonly { id: string; delta: unknown }[] },
	id: string,
) => result.changes.find((c) => c.id === id)?.delta ?? null;
const unchanged = (result: { unchanged: readonly { id: string }[] }) =>
	result.unchanged.map((u) => u.id);

describe("transfer kinds", () => {
	it("TRANSFER: Savings to Digital wallet with a bank fee (§2.3)", async () => {
		const p = await places();
		const result = await move(p, {
			fromAccountId: p.savings,
			toAccountId: p.wallet,
			fromAmount: "300000",
			fee: { amount: "1500" },
		});

		expect(result.value.kind).toBe("TRANSFER");
		expect(await balanceOf(p.savings)).toBe("4698500");
		expect(await balanceOf(p.wallet)).toBe("1300000");
		expect(result.value.netWorthEffect).toEqual(ARS(-150_000));
		expect(delta(result, "netWorth")).toEqual(ARS(-150_000));
		// The fee is spending; the transfer is not.
		expect(delta(result, "spent")).toEqual(ARS(150_000));
		expect(result.value.budget).toMatchObject({ effect: "none" });
	});

	it("EXCHANGE: buying USD 300 for ARS 442,500 costs ARS 2,100 against Blue (§2.4)", async () => {
		const p = await places();
		const result = await move(p, {
			fromAccountId: p.wallet,
			toAccountId: p.usdCash,
			fromAmount: "442500",
			toAmount: "300",
		});

		expect(result.value).toMatchObject({
			kind: "EXCHANGE",
			rate: { base: "USD", quote: "ARS", value: "1475.000000" },
			vsReference: ARS(-210_000),
			referenceRateType: "blue",
			netWorthEffect: ARS(-210_000),
			budget: { effect: "leaves", minor: 44_250_000, currency: "ARS" },
		});
		expect(await balanceOf(p.wallet)).toBe("557500");
		expect(await balanceOf(p.usdCash)).toBe("300");
		expect(delta(result, "netWorthChange.exchange")).toEqual(ARS(-210_000));
	});

	it("CARD_PAYMENT: paying the card in full moves no net worth (I11)", async () => {
		const p = await places();
		const result = await move(p, {
			fromAccountId: p.savings,
			toAccountId: p.card,
			fromAmount: "842600",
		});

		expect(result.value.kind).toBe("CARD_PAYMENT");
		expect(await balanceOf(p.card)).toBe("0");
		expect(await balanceOf(p.savings)).toBe("4157400");
		expect(unchanged(result)).toContain("netWorth");
		expect(result.value.budget).toMatchObject({ effect: "none" });
	});

	it("DEBT_PAYMENT: a loan payment lowers the loan and leaves net worth alone (I11)", async () => {
		const p = await places();
		const result = await move(p, {
			fromAccountId: p.savings,
			toAccountId: p.loan,
			fromAmount: "100000",
		});

		expect(result.value.kind).toBe("DEBT_PAYMENT");
		expect(await balanceOf(p.loan)).toBe("1900000");
		expect(unchanged(result)).toContain("netWorth");
		// The loan is outside the budget, so the principal leaves it (SPEC §5.11).
		expect(result.value.budget).toMatchObject({
			effect: "leaves",
			minor: 10_000_000,
		});
	});

	it("WITHDRAWAL: cash into Not tracked keeps net worth (§2.7, N75)", async () => {
		const p = await places();
		const result = await move(p, {
			fromAccountId: p.wallet,
			toAccountId: null,
			toCurrency: "ARS",
			fromAmount: "100000",
			kind: "WITHDRAWAL",
		});

		expect(result.value.kind).toBe("WITHDRAWAL");
		expect(await balanceOf(p.wallet)).toBe("900000");
		expect(delta(result, "notTracked")).toEqual(ARS(10_000_000));
		expect(unchanged(result)).toContain("netWorth");
	});
});

describe("money moves invariants (MONEY-MOVES §3)", () => {
	it("I11 paying a foreign debt moves net worth only by its exchange result", async () => {
		const p = await places();
		const usdLoan = await openAccount(
			p.userId,
			"USD loan",
			"LIABILITY_LOAN",
			"USD",
			1000,
			{
				exchangeRateType: "blue",
			},
		);
		// USD 100 of the loan paid with ARS 146,800, exactly Blue: no result.
		const atBlue = await move(p, {
			fromAccountId: p.savings,
			toAccountId: usdLoan,
			fromAmount: "146800",
			toAmount: "100",
		});
		expect(unchanged(atBlue)).toContain("netWorth");
		// USD 100 more for ARS 150,000: ARS 3,200 above Blue.
		const above = await move(p, {
			fromAccountId: p.savings,
			toAccountId: usdLoan,
			fromAmount: "150000",
			toAmount: "100",
		});
		expect(delta(above, "netWorth")).toEqual(ARS(-320_000));
		expect(await balanceOf(usdLoan)).toBe("800");
	});

	it("I12 every leg lands: each move's legs net to zero at its own rate, one place each", async () => {
		const p = await places();
		const same = await move(p, {
			fromAccountId: p.savings,
			toAccountId: p.wallet,
			fromAmount: "300000",
		});
		const fx = await move(p, {
			fromAccountId: p.wallet,
			toAccountId: p.usdCash,
			fromAmount: "442500",
			toAmount: "300",
		});
		const untracked = await move(p, {
			fromAccountId: null,
			fromCurrency: "ARS",
			toAccountId: p.wallet,
			fromAmount: "5000",
		});

		const legsOf = (transferId: string) =>
			adminDb.accountLeg.findMany({
				where: { transferId },
				orderBy: { amount: "asc" },
			});
		const sameLegs = await legsOf(same.value.transferId);
		expect(sameLegs.map((l) => [l.accountId, l.amount.toString()])).toEqual([
			[p.savings, "-300000"],
			[p.wallet, "300000"],
		]);
		const [paid, got] = await legsOf(fx.value.transferId);
		// At the move's own rate (1,475 per USD) the legs cancel.
		expect(
			dec(paid?.amount.toString() ?? "0")
				.add(dec(got?.amount.toString() ?? "0").mul("1475"))
				.toString(),
		).toBe("0");
		const ntLegs = await legsOf(untracked.value.transferId);
		expect(ntLegs.map((l) => [l.accountId, l.amount.toString()])).toEqual([
			[null, "-5000"],
			[p.wallet, "5000"],
		]);
	});

	it("I14 same side, no budget: both in or both out leaves the budget alone", async () => {
		const p = await places();
		const inside = await move(p, {
			fromAccountId: p.savings,
			toAccountId: p.wallet,
			fromAmount: "1000",
		});
		const outside = await move(p, {
			fromAccountId: p.wise,
			toAccountId: p.usdCash,
			fromAmount: "100",
		});
		expect(inside.value.budget).toMatchObject({ effect: "none" });
		expect(outside.value.budget).toMatchObject({ effect: "none" });
	});

	it("I15 crossing moves the budget by the in-budget leg as typed", async () => {
		const p = await places();
		const out = await move(p, {
			fromAccountId: p.wallet,
			toAccountId: p.usdCash,
			fromAmount: "442500",
			toAmount: "300",
		});
		const back = await move(p, {
			fromAccountId: p.wise,
			toAccountId: p.wallet,
			fromAmount: "1000",
			toAmount: "1460000",
		});
		expect(out.value.budget).toMatchObject({
			effect: "leaves",
			minor: 44_250_000,
		});
		expect(back.value.budget).toMatchObject({
			effect: "enters",
			minor: 146_000_000,
		});
		// Selling at 1,460 when Wise values dollars at 1,412: +48,000; 8,000 less than Blue.
		expect(back.value.netWorthEffect).toEqual(ARS(4_800_000));
		expect(back.value.vsReference).toEqual(ARS(-800_000));
	});

	it("I19 spending excludes moves: no kind of move changes spent", async () => {
		const p = await places();
		const run = forUser(p.userId);
		for (const input of [
			{ fromAccountId: p.savings, toAccountId: p.wallet, fromAmount: "1000" },
			{
				fromAccountId: p.wallet,
				toAccountId: p.usdCash,
				fromAmount: "14680",
				toAmount: "10",
			},
			{ fromAccountId: p.savings, toAccountId: p.card, fromAmount: "1000" },
			{ fromAccountId: p.savings, toAccountId: p.loan, fromAmount: "1000" },
			{
				fromAccountId: p.wallet,
				toAccountId: null,
				toCurrency: "ARS",
				fromAmount: "1000",
				kind: "WITHDRAWAL" as const,
			},
		]) {
			const applied = await run.apply(createTransfer, input);
			expect(unchanged(applied)).toContain("spent");
			const undone = await run.preview(deleteTransfer, {
				transferId: applied.value.transferId,
			});
			expect(unchanged(undone)).toContain("spent");
		}
	});

	it("I21 typed amounts win: the move stores exactly what was typed", async () => {
		const p = await places();
		const { value } = await move(p, {
			fromAccountId: p.wallet,
			toAccountId: p.usdCash,
			fromAmount: "442500",
			toAmount: "300",
		});
		const stored = await adminDb.transfer.findUniqueOrThrow({
			where: { id: value.transferId },
		});
		expect([
			stored.fromAmount.toString(),
			stored.fromCurrency,
			stored.toAmount.toString(),
			stored.toCurrency,
		]).toEqual(["442500", "ARS", "300", "USD"]);
	});
});

describe("preview and undo (R30)", () => {
	it("preview shows exactly what saving changes and writes nothing", async () => {
		const p = await places();
		const input = {
			id: "preview-equals-apply",
			fromAccountId: p.wallet,
			toAccountId: p.usdCash,
			fromAmount: "442500",
			toAmount: "300",
		};
		const preview = await forUser(p.userId).preview(createTransfer, input);
		expect(await adminDb.transfer.count({ where: { userId: p.userId } })).toBe(
			0,
		);
		expect(await balanceOf(p.wallet)).toBe("1000000");

		const applied = await forUser(p.userId).apply(createTransfer, input);
		expect(applied.changes).toEqual(preview.changes);
		expect(applied.unchanged).toEqual(preview.unchanged);
		expect(applied.value).toEqual(preview.value);
	});

	it("undo takes the move, its fee and its legs back, and recreate brings it back", async () => {
		const p = await places();
		const { value, undo } = await move(p, {
			fromAccountId: p.wallet,
			toAccountId: p.usdCash,
			fromAmount: "442500",
			toAmount: "300",
			fee: { amount: "1500" },
		});
		expect(undo).toEqual({
			kind: "revert",
			mutation: "transfer.delete",
			rows: [{ table: "transfer", id: value.transferId }],
		});

		const deleted = await forUser(p.userId).apply(deleteTransfer, {
			transferId: value.transferId,
		});
		expect(await balanceOf(p.wallet)).toBe("1000000");
		expect(await balanceOf(p.usdCash)).toBe("0");
		expect(
			await adminDb.accountLeg.count({ where: { userId: p.userId } }),
		).toBe(0);
		expect(await adminDb.expense.count({ where: { userId: p.userId } })).toBe(
			0,
		);

		await forUser(p.userId).apply(createTransfer, deleted.value.recreate);
		expect(await balanceOf(p.wallet)).toBe("556000");
		expect(await balanceOf(p.usdCash)).toBe("300");
		expect(
			await adminDb.transfer.findUnique({ where: { id: value.transferId } }),
		).not.toBeNull();
	});
});

describe("refusals", () => {
	it("refuses a future date, a closed account and another user's account", async () => {
		const p = await places();
		const other = await places();
		const tomorrow = new Date(TODAY.getTime() + 2 * 86_400_000)
			.toISOString()
			.slice(0, 10);
		await expect(
			move(p, {
				fromAccountId: p.savings,
				toAccountId: p.wallet,
				fromAmount: "1",
				date: tomorrow,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await closeAccount(adminDb, p.userId, p.wallet);
		await expect(
			move(p, {
				fromAccountId: p.savings,
				toAccountId: p.wallet,
				fromAmount: "1",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			move(p, {
				fromAccountId: other.savings,
				toAccountId: p.savings,
				fromAmount: "1",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await other.db.transfer.count()).toBe(0);
	});

	it("dates a move in the past and counts it from that day", async () => {
		const p = await places();
		const day = daysAgo(3).toISOString().slice(0, 10);
		const { value } = await move(p, {
			fromAccountId: p.savings,
			toAccountId: p.wallet,
			fromAmount: "1000",
			date: day,
		});
		const leg = await adminDb.accountLeg.findFirstOrThrow({
			where: { transferId: value.transferId },
		});
		expect(leg.date.toISOString().slice(0, 10)).toBe(day);
	});
});

describe("I20 one value per transaction", () => {
	it("a move's booked value stays when rates move; only holdings revalue", async () => {
		const p = await places();
		const { value } = await move(p, {
			fromAccountId: p.wallet,
			toAccountId: p.usdCash,
			fromAmount: "442500",
			toAmount: "300",
		});
		const rate = {
			date_currency_type: { date: TODAY, currency: "ARS", type: "blue" },
		};
		await adminDb.exchangeRate.update({ where: rate, data: { rate: "1500" } });
		try {
			const legs = await adminDb.accountLeg.findMany({
				where: { transferId: value.transferId },
			});
			expect(legs.map((l) => l.homeAmount?.toString()).sort()).toEqual([
				"-442500",
				"440400",
			]);
			const readings = await readFigures(p.userId, ["netWorthChange.exchange"]);
			expect(readings.get("netWorthChange.exchange")).toEqual([ARS(-210_000)]);
		} finally {
			await adminDb.exchangeRate.update({
				where: rate,
				data: { rate: "1468" },
			});
		}
	});
});
