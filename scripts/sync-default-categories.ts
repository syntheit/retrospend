import { DEFAULT_CATEGORIES } from "../src/lib/constants";
import { db } from "../src/server/db";

async function main() {
	console.log("Starting category sync for all users...");

	const users = await db.user.findMany({
		select: { id: true, username: true },
	});

	console.log(`Found ${users.length} users to process`);

	let processed = 0;
	let totalCategoriesCreated = 0;

	for (const user of users) {
		try {
			const result = await db.category.createMany({
				data: DEFAULT_CATEGORIES.map((category) => ({
					name: category.name,
					color: category.color,
					userId: user.id,
				})),
				skipDuplicates: true,
			});

			processed++;
			totalCategoriesCreated += result.count;

			if (processed % 10 === 0) {
				console.log(`Processed ${processed}/${users.length} users...`);
			}
		} catch (error) {
			console.error(
				`Failed to sync categories for user ${user.username} (${user.id}):`,
				error,
			);
		}
	}

	console.log(`Sync completed!`);
	console.log(`- Processed ${processed} users`);
	console.log(
		`- Created ${totalCategoriesCreated} new category records (duplicates skipped)`,
	);

	// Optional: Show a sample user's categories for verification
	const sampleUser = users[0];
	if (sampleUser) {
		const sampleCategories = await db.category.findMany({
			where: { userId: sampleUser.id },
			select: { name: true, color: true },
			orderBy: { name: "asc" },
		});

		console.log(
			`\nSample user (${sampleUser.username}) now has ${sampleCategories.length} categories:`,
		);
		sampleCategories.forEach((cat) => {
			console.log(`  - ${cat.name} (${cat.color})`);
		});
	}
}

main()
	.catch((err) => {
		console.error("Script failed:", err);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
		console.log("Database connection closed.");
	});
