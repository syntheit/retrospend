import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL!;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
	console.log("Starting migration of budget types...");

	// 1. Find all budgets where pegToActual is true
	const peggedBudgets = await prisma.budget.findMany({
		where: {
			pegToActual: true,
			// We only want to migrate ones that are technically still "FIXED" (default)
			// to avoid double-running if script is run multiple times, though it's idempotent-ish.
			type: "FIXED",
		},
	});

	console.log(
		`Found ${peggedBudgets.length} budgets to migrate from 'pegToActual=true' to 'type=PEG_TO_ACTUAL'.`,
	);

	let updatedCount = 0;

	for (const budget of peggedBudgets) {
		await prisma.budget.update({
			where: { id: budget.id },
			data: {
				type: "PEG_TO_ACTUAL",
			},
		});
		updatedCount++;
	}

	console.log(`Successfully migrated ${updatedCount} budgets.`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
