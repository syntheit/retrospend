import { db } from "../src/server/db";

async function main() {
	console.log("Verifying category counts per user...");

	// Get user count and category distribution
	const userCategoryCounts = await db.category.groupBy({
		by: ['userId'],
		_count: {
			userId: true,
		},
	});

	console.log(`\nCategory count distribution across ${userCategoryCounts.length} users:`);

	const counts = userCategoryCounts.map(uc => uc._count.userId).sort((a, b) => a - b);
	const uniqueCounts = [...new Set(counts)];

	uniqueCounts.forEach(count => {
		const usersWithCount = userCategoryCounts.filter(uc => uc._count.userId === count).length;
		console.log(`- ${usersWithCount} users have ${count} categories`);
	});

	// Sample a few users' actual categories
	console.log("\nSampling categories from first 3 users:");
	const sampleUsers = await db.user.findMany({
		select: { id: true, username: true },
		take: 3
	});

	for (const user of sampleUsers) {
		const categories = await db.category.findMany({
			where: { userId: user.id },
			select: { name: true, color: true },
			orderBy: { name: 'asc' }
		});

		console.log(`\nUser: ${user.username}`);
		console.log(`Categories (${categories.length}):`);
		categories.forEach(cat => {
			console.log(`  - ${cat.name} (${cat.color})`);
		});
	}

	// Check for any missing default categories
	const totalUsers = await db.user.count();
	const expectedDefaults = (await import("../src/lib/constants")).DEFAULT_CATEGORIES.length;

	console.log(`\nExpected minimum categories per user: ${expectedDefaults}`);
	console.log(`Total users: ${totalUsers}`);

	const usersWithMinCategories = userCategoryCounts.filter(uc => uc._count.userId >= expectedDefaults).length;
	console.log(`Users with at least ${expectedDefaults} categories: ${usersWithMinCategories}/${totalUsers}`);
}

main()
	.catch((err) => {
		console.error("Verification failed:", err);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
		console.log("\nDatabase connection closed.");
	});
