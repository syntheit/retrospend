import { db } from "../server/db";

const STRONG_CURRENCIES = ["GBP", "EUR", "KWD", "BHD", "OMR", "JOD", "USD"];
const DRY_RUN = false;

async function main() {
    console.log("🔍 Scanning for corrupt wealth snapshots...");
    console.log(`ℹ️ Mode: ${DRY_RUN ? "DRY RUN (No changes)" : "LIVE (Will delete data)"}`);
    console.log("----------------------------------------");

    const snapshots = await db.assetSnapshot.findMany({
        include: {
            account: {
                select: {
                    currency: true,
                    type: true
                }
            }
        },
        where: {
            // Basic filter to reduce dataset (e.g. at least 100 USD)
            balanceInUSD: { gt: 100 } 
        }
    });

    const toDelete = [];

    for (const snap of snapshots) {
        const currency = snap.account.currency;
        const balance = Number(snap.balance);
        const usd = Number(snap.balanceInUSD);

        if (STRONG_CURRENCIES.includes(currency)) continue;
        if (balance === 0) continue;

        // Detection Logic:
        // If USD is > 1.5x Balance for a weak currency, it's likely inverted.
        // e.g. 1M ARS -> 2.7B USD (instead of ~700 USD)
        // Rate used was likely ~1430 instead of 1/1430
        if (Math.abs(usd) > Math.abs(balance) * 1.5) {
             const dateStr = snap.date.toISOString().split('T')[0];
             console.log(`❌ Found Bad Snapshot [${dateStr}]: Asset ${snap.accountId.slice(0, 8)}... (${currency})`);
             console.log(`   Bal: ${balance.toLocaleString()} ${currency} -> USD: $${usd.toLocaleString()}`);
             toDelete.push(snap.id);
        }
    }

    if (toDelete.length === 0) {
        console.log("\n✅ No corrupt snapshots found.");
        return;
    }

    console.log("----------------------------------------");
    console.log(`Found ${toDelete.length} corrupt snapshots.`);

    if (DRY_RUN) {
        console.log("\n⚠️ DRY RUN: Skipping deletion.");
        console.log("To delete these records, edit this script to set DRY_RUN = false.");
        return;
    }

    console.log("Deleting...");

    const result = await db.assetSnapshot.deleteMany({
        where: {
            id: { in: toDelete }
        }
    });

    console.log(`✅ Deleted ${result.count} snapshots.`);
    console.log("The system will regenerate correct history on the next dashboard load/update.");
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
