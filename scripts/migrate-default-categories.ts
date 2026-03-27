/**
 * Category Migration Script
 *
 * Migrates existing users' default categories:
 * - Renames: "Dining Out" → "Restaurants", "Tech" → "Electronics", "Misc" → "Other"
 * - Removals: "Gas" → merge into "Transport", "Rideshare" → merge into "Transport"
 * - Additions: "Clothing" (pink), "Entertainment" (violet), "Gifts" (amber)
 * - Color fixes: "Taxes" red→slate, "Hobby" rose→cyan
 *
 * Usage:
 *   npx tsx scripts/migrate-default-categories.ts           # execute
 *   npx tsx scripts/migrate-default-categories.ts --dry-run  # preview only
 *
 * Tested scenarios (see comments at bottom):
 *  1. Fresh user with unmodified defaults
 *  2. User who deleted "Transport" — Gas/Rideshare merge recreates it
 *  3. User who already has "Restaurants" — Dining Out expenses merge, no duplicate
 *  4. User who renamed "Misc" to something else — script skips (no "Misc" found)
 *  5. User who changed "Taxes" color — script does NOT overwrite custom color
 */

import "dotenv/config";
import { db } from "../src/server/db";

const DRY_RUN = process.argv.includes("--dry-run");

// Prisma interactive transaction client type (same model methods as db,
// minus connection/lifecycle methods)
type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Migration definitions
// ---------------------------------------------------------------------------

const RENAMES = [
	{ oldName: "Dining Out", newName: "Restaurants" },
	{ oldName: "Tech", newName: "Electronics" },
	{ oldName: "Misc", newName: "Other" },
] as const;

const REMOVALS = [
	{ sourceName: "Gas", targetName: "Transport", targetColor: "slate" },
	{ sourceName: "Rideshare", targetName: "Transport", targetColor: "slate" },
] as const;

const ADDITIONS = [
	{ name: "Clothing", color: "pink" },
	{ name: "Entertainment", color: "violet" },
	{ name: "Gifts", color: "amber" },
] as const;

const COLOR_FIXES = [
	{ name: "Taxes", oldColor: "red", newColor: "slate" },
	{ name: "Hobby", oldColor: "rose", newColor: "cyan" },
] as const;

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------

const stats = {
	usersProcessed: 0,
	renames: new Map<string, number>(),
	renameMerges: new Map<string, number>(),
	merges: new Map<string, number>(),
	additions: new Map<string, number>(),
	colorFixes: new Map<string, number>(),
	skipped: 0,
	errors: [] as { userId: string; username: string; error: string }[],
};

function incr(map: Map<string, number>, key: string) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

// ---------------------------------------------------------------------------
// Merge all references from one category to another, then delete source
// ---------------------------------------------------------------------------

async function mergeCategoryReferences(
	tx: TxClient,
	sourceId: string,
	targetId: string,
	userId: string,
) {
	// 1. Expenses
	await tx.expense.updateMany({
		where: { categoryId: sourceId, userId },
		data: { categoryId: targetId },
	});

	// 2. Budgets — handle unique(userId, categoryId, period) conflicts
	const conflictingBudgets = await tx.budget.findMany({
		where: { categoryId: targetId, userId },
		select: { period: true },
	});
	const conflictPeriods = conflictingBudgets.map((b) => b.period);
	if (conflictPeriods.length > 0) {
		// Delete source budgets that would conflict with existing target budgets
		await tx.budget.deleteMany({
			where: {
				categoryId: sourceId,
				userId,
				period: { in: conflictPeriods },
			},
		});
	}
	await tx.budget.updateMany({
		where: { categoryId: sourceId, userId },
		data: { categoryId: targetId },
	});

	// 3. RecurringTemplates
	await tx.recurringTemplate.updateMany({
		where: { categoryId: sourceId, userId },
		data: { categoryId: targetId },
	});

	// 4. SharedTransactions (no userId field — sourceId is globally unique)
	await tx.sharedTransaction.updateMany({
		where: { categoryId: sourceId },
		data: { categoryId: targetId },
	});

	// 5. AnalyticsCategoryPreference — handle unique(userId, categoryId) conflicts
	const existingTargetPref =
		await tx.analyticsCategoryPreference.findUnique({
			where: { userId_categoryId: { userId, categoryId: targetId } },
		});
	if (existingTargetPref) {
		// Target already has a preference; just delete the source one
		await tx.analyticsCategoryPreference.deleteMany({
			where: { userId, categoryId: sourceId },
		});
	} else {
		await tx.analyticsCategoryPreference.updateMany({
			where: { userId, categoryId: sourceId },
			data: { categoryId: targetId },
		});
	}
}

// ---------------------------------------------------------------------------
// Process a single user inside a transaction
// ---------------------------------------------------------------------------

interface UserActions {
	renames: string[];
	renameMerges: string[];
	merges: string[];
	additions: string[];
	colorFixes: string[];
}

async function processUser(
	tx: TxClient,
	userId: string,
): Promise<UserActions> {
	const actions: UserActions = {
		renames: [],
		renameMerges: [],
		merges: [],
		additions: [],
		colorFixes: [],
	};

	// Load all categories for this user into a local lookup map
	type CatEntry = { id: string; name: string; color: string };
	const userCategories: CatEntry[] = await tx.category.findMany({
		where: { userId },
		select: { id: true, name: true, color: true },
	});
	const catByName = new Map<string, CatEntry>(
		userCategories.map((c) => [c.name, c]),
	);

	// ── RENAMES ──────────────────────────────────────────────────────────
	for (const { oldName, newName } of RENAMES) {
		const oldCat = catByName.get(oldName);
		if (!oldCat) continue; // User doesn't have the old category — skip

		const existingNewCat = catByName.get(newName);
		if (existingNewCat) {
			// User already has a category with the new name.
			// Merge all references from old → existing, then delete old.
			if (!DRY_RUN) {
				await mergeCategoryReferences(tx, oldCat.id, existingNewCat.id, userId);
				await tx.category.delete({ where: { id: oldCat.id } });
			}
			actions.renameMerges.push(`${oldName} → ${newName}`);
			catByName.delete(oldName);
		} else {
			// Simple rename
			if (!DRY_RUN) {
				await tx.category.update({
					where: { id: oldCat.id },
					data: { name: newName },
				});
			}
			actions.renames.push(`${oldName} → ${newName}`);
			catByName.delete(oldName);
			catByName.set(newName, { ...oldCat, name: newName });
		}
	}

	// ── REMOVALS (merge into target) ─────────────────────────────────────
	for (const { sourceName, targetName, targetColor } of REMOVALS) {
		const sourceCat = catByName.get(sourceName);
		if (!sourceCat) continue; // User doesn't have the source — skip

		let targetCat = catByName.get(targetName);

		// If target doesn't exist (user deleted it), recreate it
		if (!targetCat) {
			if (!DRY_RUN) {
				const created = await tx.category.create({
					data: {
						name: targetName,
						color: targetColor,
						userId,
					},
					select: { id: true, name: true, color: true },
				});
				targetCat = created;
			} else {
				targetCat = { id: "dry-run-placeholder", name: targetName, color: targetColor };
			}
			catByName.set(targetName, targetCat);
		}

		if (!DRY_RUN) {
			await mergeCategoryReferences(tx, sourceCat.id, targetCat.id, userId);
			await tx.category.delete({ where: { id: sourceCat.id } });
		}
		actions.merges.push(`${sourceName} → ${targetName}`);
		catByName.delete(sourceName);
	}

	// ── ADDITIONS ─────────────────────────────────────────────────────────
	for (const { name, color } of ADDITIONS) {
		if (catByName.has(name)) continue; // Already exists — skip

		if (!DRY_RUN) {
			const created = await tx.category.create({
				data: { name, color, userId },
				select: { id: true, name: true, color: true },
			});
			catByName.set(name, created);
		}
		actions.additions.push(name);
	}

	// ── COLOR FIXES ───────────────────────────────────────────────────────
	for (const { name, oldColor, newColor } of COLOR_FIXES) {
		const cat = catByName.get(name);
		if (!cat) continue; // User doesn't have this category

		// Only fix if the color still matches the OLD default (user hasn't customized)
		if (cat.color !== oldColor) continue;

		if (!DRY_RUN) {
			await tx.category.update({
				where: { id: cat.id },
				data: { color: newColor },
			});
		}
		actions.colorFixes.push(`${name}: ${oldColor} → ${newColor}`);
	}

	return actions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log(
		`\n${"=".repeat(60)}\nCategory Migration${DRY_RUN ? " (DRY RUN)" : ""}\n${"=".repeat(60)}\n`,
	);

	const users = await db.user.findMany({
		select: { id: true, username: true },
		orderBy: { createdAt: "asc" },
	});

	console.log(`Found ${users.length} users to process\n`);

	for (let i = 0; i < users.length; i++) {
		const user = users[i]!;

		try {
			const actions = await db.$transaction(async (tx) => {
				return processUser(tx, user.id);
			});

			stats.usersProcessed++;

			// Tally stats
			for (const r of actions.renames) incr(stats.renames, r);
			for (const r of actions.renameMerges) incr(stats.renameMerges, r);
			for (const m of actions.merges) incr(stats.merges, m);
			for (const a of actions.additions) incr(stats.additions, a);
			for (const c of actions.colorFixes) incr(stats.colorFixes, c);

			// Progress reporting
			const total =
				actions.renames.length +
				actions.renameMerges.length +
				actions.merges.length +
				actions.additions.length +
				actions.colorFixes.length;

			if (total === 0) {
				stats.skipped++;
			}

			if (total > 0) {
				const parts: string[] = [];
				if (actions.renames.length) parts.push(`${actions.renames.length} rename(s)`);
				if (actions.renameMerges.length) parts.push(`${actions.renameMerges.length} rename-merge(s)`);
				if (actions.merges.length) parts.push(`${actions.merges.length} merge(s)`);
				if (actions.additions.length) parts.push(`${actions.additions.length} addition(s)`);
				if (actions.colorFixes.length) parts.push(`${actions.colorFixes.length} color fix(es)`);
				console.log(`  [${i + 1}/${users.length}] ${user.username}: ${parts.join(", ")}`);
			}

			if ((i + 1) % 50 === 0) {
				console.log(`  ... processed ${i + 1}/${users.length} users`);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			stats.errors.push({ userId: user.id, username: user.username, error: msg });
			console.error(`  ERROR [${user.username}] (${user.id}): ${msg}`);
		}
	}

	// ── Summary ──────────────────────────────────────────────────────────
	console.log(`\n${"=".repeat(60)}`);
	console.log(`SUMMARY${DRY_RUN ? " (DRY RUN — no changes written)" : ""}`);
	console.log("=".repeat(60));
	console.log(`Users processed: ${stats.usersProcessed}`);

	const sumMap = (m: Map<string, number>) =>
		Array.from(m.values()).reduce((a, b) => a + b, 0);
	const printMap = (m: Map<string, number>) =>
		Array.from(m.entries()).forEach(([key, count]) =>
			console.log(`  ${key}: ${count} users`),
		);

	const totalRenames = sumMap(stats.renames);
	console.log(`\nRenames performed: ${totalRenames}`);
	printMap(stats.renames);

	const totalRenameMerges = sumMap(stats.renameMerges);
	if (totalRenameMerges > 0) {
		console.log(`\nRename-merges (conflict resolution): ${totalRenameMerges}`);
		printMap(stats.renameMerges);
	}

	const totalMerges = sumMap(stats.merges);
	console.log(`\nMerges performed: ${totalMerges}`);
	printMap(stats.merges);

	const totalAdditions = sumMap(stats.additions);
	console.log(`\nAdditions performed: ${totalAdditions}`);
	printMap(stats.additions);

	const totalColorFixes = sumMap(stats.colorFixes);
	console.log(`\nColor fixes performed: ${totalColorFixes}`);
	printMap(stats.colorFixes);

	console.log(`\nSkipped (no changes needed): ${stats.skipped}`);
	console.log(`Errors: ${stats.errors.length}`);
	if (stats.errors.length > 0) {
		for (const e of stats.errors) {
			console.log(`  ${e.username} (${e.userId}): ${e.error}`);
		}
	}

	console.log("");
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

// ---------------------------------------------------------------------------
// Test Scenarios (mental model)
// ---------------------------------------------------------------------------
//
// 1. FRESH USER WITH UNMODIFIED DEFAULTS
//    Has all 23 original categories with original colors.
//    - "Dining Out" → renamed to "Restaurants"
//    - "Tech" → renamed to "Electronics"
//    - "Misc" → renamed to "Other"
//    - "Gas" → merged into "Transport", then deleted
//    - "Rideshare" → merged into "Transport", then deleted
//    - "Clothing" (pink) → created
//    - "Entertainment" (violet) → created
//    - "Gifts" (amber) → created
//    - "Taxes" color red → slate (still original → updated)
//    - "Hobby" color rose → cyan (still original → updated)
//    Result: 23 - 2 (Gas, Rideshare) + 3 (Clothing, Entertainment, Gifts) = 24 categories
//
// 2. USER WHO DELETED "TRANSPORT"
//    Has Gas and Rideshare but no Transport.
//    - Gas merge: Transport doesn't exist → created with color "slate", Gas merged in, deleted
//    - Rideshare merge: Transport now exists (just created) → Rideshare merged in, deleted
//    Result: Transport recreated, Gas + Rideshare removed
//
// 3. USER WHO ALREADY HAS "RESTAURANTS"
//    Has both "Dining Out" and "Restaurants" (manually created).
//    - Rename step finds "Dining Out" AND "Restaurants" exists
//    - All expenses/budgets/recurring/shared from "Dining Out" → moved to "Restaurants"
//    - "Dining Out" deleted
//    Result: No duplicate, expenses safely merged
//
// 4. USER WHO RENAMED "MISC" TO SOMETHING ELSE
//    User renamed "Misc" to e.g. "Random Stuff".
//    - catByName.get("Misc") returns undefined → skipped entirely
//    - No "Other" category added because we only add in the ADDITIONS step
//      (but "Other" is NOT in ADDITIONS — it's only created via rename)
//    Note: This means users who deleted/renamed "Misc" won't get "Other".
//    This is intentional — we don't force categories on users.
//
// 5. USER WHO CHANGED "TAXES" COLOR
//    User changed Taxes from red to e.g. blue.
//    - cat.color ("blue") !== oldColor ("red") → skipped
//    Result: Custom color preserved
