import { pathToFileURL } from "node:url";
import { db } from "../src/server/db";
import { seedDefaultCategories } from "../src/server/services/category.service";
import { compareText } from "../src/server/services/text-order";

/** One user's missing defaults, as that user, each name with its index (the sign-up write). */
export const syncUserCategories = (userId: string) =>
	seedDefaultCategories(db, userId);

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
			const created = await syncUserCategories(user.id);

			processed++;
			totalCategoriesCreated += created;

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
		// Sorted here: a name may be ciphertext in the database.
		const sampleCategories = (
			await db.category.findMany({
				where: { userId: sampleUser.id },
				select: { name: true, color: true },
			})
		).sort((a, b) => compareText(a.name, b.name));

		console.log(
			`\nSample user (${sampleUser.username}) now has ${sampleCategories.length} categories:`,
		);
		sampleCategories.forEach((cat) => {
			console.log(`  - ${cat.name} (${cat.color})`);
		});
	}
}

// Run only as a script, so a test can import syncUserCategories.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main()
		.catch((err) => {
			console.error("Script failed:", err);
			process.exit(1);
		})
		.finally(async () => {
			await db.$disconnect();
			console.log("Database connection closed.");
		});
