/**
 * Finds expenses whose stored exchangeRate / amountInUSD do not match the
 * stored rate convention (src/lib/money.ts) and, with --apply, fixes them.
 * Detection rules and fixes: src/server/money-repair.ts.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/repair-amount-in-usd.ts          # dry run
 *   DATABASE_URL=... npx tsx scripts/repair-amount-in-usd.ts --apply  # write
 *
 * Dry run is the default. --apply runs every update in one transaction and
 * refuses to run while expense."exchangeRate" still has fewer than 6 decimals
 * (deploy the 20261021000000 migration first).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { USD } from "@retrospend/domain/money";
import {
	findInconsistentExpenses,
	type RepairFinding,
} from "../src/server/money-repair";
import { PrismaClient } from "../generated/prisma/client";

const APPLY = process.argv.includes("--apply");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	console.error("DATABASE_URL environment variable is required.");
	process.exit(1);
}

const pool = new Pool({ connectionString });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

function maskUrl(url: string): string {
	return url.replace(/\/\/([^:@/]+):[^@]*@/, "//$1:***@");
}

function report(
	findings: RepairFinding[],
	scanned: { total: number; nonUsd: number; children: number },
	noTableRate: Map<string, number>,
) {
	console.log(
		`Scanned ${scanned.total} expenses (${scanned.nonUsd} non-USD, ${scanned.children} amortized children).`,
	);
	console.log(`Inconsistent: ${findings.length}`);
	if (noTableRate.size > 0) {
		console.log(
			`Skipped, no rate in the table: ${[...noTableRate].map(([c, n]) => `${c} x${n}`).join(", ")}`,
		);
	}
	console.log("");

	const byReason = new Map<string, number>();
	for (const f of findings) {
		byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
	}
	if (byReason.size > 0) {
		console.log("By reason:");
		for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
			console.log(`  ${reason.padEnd(13)} ${n}`);
		}
		console.log("");
	}

	const byCurrency = new Map<
		string,
		{ count: number; before: number; after: number }
	>();
	for (const f of findings) {
		const c = byCurrency.get(f.row.currency) ?? { count: 0, before: 0, after: 0 };
		c.count++;
		c.before += f.row.amountInUSD;
		c.after += f.newUSD;
		byCurrency.set(f.row.currency, c);
	}
	if (byCurrency.size > 0) {
		console.log("By currency (USD totals of the affected expenses):");
		console.log("  currency  count       USD before        USD after");
		for (const [currency, c] of [...byCurrency].sort(
			(a, b) => b[1].count - a[1].count,
		)) {
			console.log(
				`  ${currency.padEnd(8)} ${String(c.count).padStart(6)} ${c.before.toFixed(2).padStart(16)} ${c.after.toFixed(2).padStart(16)}`,
			);
		}
		console.log("");
	}

	const worst = [...findings]
		.sort(
			(a, b) =>
				Math.abs(b.newUSD - b.row.amountInUSD) -
				Math.abs(a.newUSD - a.row.amountInUSD),
		)
		.slice(0, 15);
	if (worst.length > 0) {
		console.log("Worst examples (by USD change):");
		for (const f of worst) {
			const r = f.row;
			console.log(
				`  ${r.id}  ${r.date.toISOString().slice(0, 10)}  ${r.amount} ${r.currency}` +
					` (home ${f.home}, ${r.pricingSource ?? "-"}${r.isAmortizedChild ? ", child" : ""})` +
					`  ${f.reason}: rate ${r.exchangeRate} -> ${Number(f.newRate.toFixed(6))},` +
					` USD ${r.amountInUSD.toFixed(2)} -> ${f.newUSD.toFixed(2)}`,
			);
		}
		console.log("");
	}
}

async function main() {
	console.log(`Database: ${maskUrl(connectionString!)}`);
	console.log(`Mode: ${APPLY ? "APPLY (writes changes)" : "DRY RUN (no changes)"}`);
	console.log("");

	const [expenses, users, rates] = await Promise.all([
		db.expense.findMany({
			select: {
				id: true,
				userId: true,
				date: true,
				currency: true,
				amount: true,
				exchangeRate: true,
				amountInUSD: true,
				pricingSource: true,
				isAmortizedChild: true,
			},
		}),
		db.user.findMany({ select: { id: true, homeCurrency: true } }),
		db.exchangeRate.findMany({
			select: { currency: true, type: true, rate: true, date: true },
		}),
	]);

	const rows = expenses.map((e) => ({
		...e,
		amount: Number(e.amount),
		exchangeRate: Number(e.exchangeRate),
		amountInUSD: Number(e.amountInUSD),
	}));
	const homeOf = new Map(users.map((u) => [u.id, u.homeCurrency]));

	const { findings, noTableRate } = findInconsistentExpenses({
		expenses: rows,
		homeCurrencyOf: (userId) => homeOf.get(userId) ?? USD,
		rates: rates.map((r) => ({ ...r, rate: Number(r.rate) })),
	});

	report(
		findings,
		{
			total: rows.length,
			nonUsd: rows.filter((r) => r.currency !== USD).length,
			children: rows.filter((r) => r.isAmortizedChild).length,
		},
		noTableRate,
	);

	if (!APPLY) {
		console.log("Dry run: nothing was written. Re-run with --apply to fix.");
		return;
	}
	if (findings.length === 0) {
		console.log("Nothing to fix.");
		return;
	}

	const scale = await db.$queryRaw<{ numeric_scale: number }[]>`
		SELECT numeric_scale FROM information_schema.columns
		WHERE table_name = 'expense' AND column_name = 'exchangeRate'`;
	if ((scale[0]?.numeric_scale ?? 0) < 6) {
		console.error(
			'expense."exchangeRate" has fewer than 6 decimals; deploy the 20261021000000 migration before --apply.',
		);
		process.exitCode = 1;
		return;
	}

	await db.$transaction(
		findings.map((f) =>
			db.expense.update({
				where: { id: f.row.id },
				data: {
					exchangeRate: Number(f.newRate.toFixed(6)),
					amountInUSD: f.newUSD,
				},
			}),
		),
	);
	console.log(`Updated ${findings.length} expenses.`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
		await pool.end();
	});
