import "dotenv/config";
import { getBestExchangeRate } from "~/server/api/routers/shared-currency";
import { db as prisma } from "~/server/db";

async function main() {
	const dryRun = process.argv.includes("--dry-run");
	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);

	console.log(`Starting wealth corruption fix. Dry run: ${dryRun}`);

	// Fetch all asset accounts to know their currencies
	const assets = await prisma.assetAccount.findMany({
		select: { id: true, currency: true },
	});

	const rates = new Map<string, number>();
	rates.set("USD", 1);

	console.log("Fetching current exchange rates...");
	const currencies = [...new Set(assets.map((a) => a.currency))];
	for (const currency of currencies) {
		if (currency === "USD") continue;
		const rate = await getBestExchangeRate(prisma, currency, today);
		if (rate) {
			rates.set(currency, rate);
		}
	}

	// Fetch all snapshots
	console.log("Scanning asset snapshots...");
	const snapshots = await prisma.assetSnapshot.findMany({
		include: {
			account: {
				select: { id: true, currency: true },
			},
		},
	});

	let fixedCount = 0;
	const totalScanned = snapshots.length;

	for (const snap of snapshots) {
		if (snap.account.currency === "USD") continue;

		const rawBalance = snap.balance.toNumber();
		const balanceInUSD = snap.balanceInUSD.toNumber();
		const currentRate = rates.get(snap.account.currency);

		if (!currentRate) {
			console.warn(
				`[SKIP] No rate found for ${snap.account.currency} (Snapshot ${snap.id})`,
			);
			continue;
		}

		const estimatedUSD = rawBalance / currentRate;

		/**
		 * The "Magic Fix" logic from wealth.ts:
		 * If balanceInUSD is more than 10x today's USD value, it's likely corrupted.
		 * (multiplied instead of divided bug)
		 */
		if (balanceInUSD > estimatedUSD * 10) {
			console.log(
				`[CORRECTING] Snapshot ${snap.id} [${snap.account.currency}]: Recorded=${balanceInUSD.toFixed(2)} USD, Corrected=${estimatedUSD.toFixed(2)} USD (Balance=${rawBalance})`,
			);

			if (!dryRun) {
				await prisma.assetSnapshot.update({
					where: { id: snap.id },
					data: { balanceInUSD: estimatedUSD },
				});
			}
			fixedCount++;
		}
	}

	console.log("\n-------------------------------------------");
	console.log(`Total scanned: ${totalScanned}`);
	console.log(`Total ${dryRun ? "identified" : "fixed"}: ${fixedCount}`);
	console.log("-------------------------------------------");
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
