/**
 * The ledger of the parity harness (E2EE P16): one user's rows in every table
 * a device syncs, in any size, deterministic from a seed. Built to cover what
 * the figures branch on: ARS rows booked at blue, at official and unbooked,
 * USD, JPY and KWD rows with their own decimals, refunds, income, drafts,
 * hidden rows, NOT_SPENDING, amortized parents and children, an INCOME
 * category, shares in every status with and without a captured rate (one in a
 * hidden project, one with a guest beside you, corrections with negative
 * shares), accounts of every kind with legs, snapshots and rate switches,
 * templates of every frequency and direction, and rows at 30 minutes either
 * side of every profile's period edges.
 *
 * This file only orders the work: one seeder per table family does the rest
 * (seed-expenses, seed-accounts, seed-templates, seed-shares), all drawing
 * from one generator in this order, so a seed gives the same rows. Money is
 * seeded as integer minor units turned into decimal text; the USD value and
 * the booked home leg come from the domain helpers the app books with (see
 * rates.ts). Ids are random UUIDs (as device-ledger.ts); the values are
 * deterministic. User rows are written through fixtureDb so the sealed
 * suite's sweep sees them sealed.
 */

import type { LedgerProfile } from "../device-ledger";
import { adminDb, createTestUser, fixtureDb } from "../pg-harness";
import {
	seedAccounts,
	seedLegs,
	seedRateSwitches,
	seedSnapshots,
} from "./seed-accounts";
import {
	edgeInstants,
	type ParitySize,
	type SeedContext,
	seedContext,
} from "./seed-context";
import { seedExpenses } from "./seed-expenses";
import { seedProjects, seedShares } from "./seed-shares";
import { seedTemplates } from "./seed-templates";

export type { ParitySize } from "./seed-context";

/** The always-on harness: a few hundred rows, every case present. */
export const SMALL_SIZE: ParitySize = {
	expenses: 400,
	legs: 60,
	shares: 30,
	accounts: 10,
	templates: 30,
	snapshots: 20,
};

/** The perf harness. */
export const LARGE_SIZE: ParitySize = {
	expenses: 10_000,
	legs: 3_000,
	shares: 500,
	accounts: 10,
	templates: 30,
	snapshots: 200,
};

export interface ParityLedger {
	userId: string;
	accountIds: string[];
	templateIds: string[];
	expenseIds: string[];
	/** Row counts the delta pulls must reach. */
	counts: {
		expenses: number;
		categories: number;
		templates: number;
		accounts: number;
		snapshots: number;
		legs: number;
		rateSwitches: number;
		shares: number;
	};
	/** The id of the project the user hides from reports. */
	hiddenProjectId: string;
	bobId: string;
}

export interface ParityOptions {
	seed: number;
	size: ParitySize;
	/** The user's own profile. */
	profile: LedgerProfile;
	/** Profiles whose period edges get rows (the user's own when absent). */
	edgeProfiles?: readonly LedgerProfile[];
	/** The instants the figures will be read at; edges are placed around the periods of each. */
	clocks: readonly Date[];
}

/** The user and Bob (who owns the shared expenses), the user set to the profile. */
async function seedUsers(profile: LedgerProfile) {
	const userId = (await createTestUser()).user.id;
	const bobId = (await createTestUser()).user.id;
	await adminDb.user.update({
		where: { id: userId },
		data: {
			homeCurrency: profile.home,
			timeZone: profile.timeZone,
			fiscalMonthStartDay: profile.startDay,
			defaultRateTypes: profile.defaultRateTypes ?? {},
		},
	});
	return { userId, bobId };
}

/** Expense categories to spread rows over, an INCOME one, and one of Bob's. */
async function seedCategories(userId: string, bobId: string) {
	const categoryIds: string[] = [];
	for (const name of ["Food", "Rent", "Travel", "Fun", "Health"])
		categoryIds.push(
			(
				await fixtureDb.category.create({
					data: { name, color: "blue", userId },
				})
			).id,
		);
	const incomeCategory = (
		await fixtureDb.category.create({
			data: { name: "Salary", color: "teal", userId, kind: "INCOME" },
		})
	).id;
	const bobCategory = (
		await fixtureDb.category.create({
			data: { name: "Bob's", color: "orange", userId: bobId },
		})
	).id;
	return { categoryIds, incomeCategory, bobCategory };
}

async function contextOf(options: ParityOptions): Promise<SeedContext> {
	const { profile } = options;
	const { userId, bobId } = await seedUsers(profile);
	return seedContext(
		{
			userId,
			bobId,
			home: profile.home,
			profile,
			size: options.size,
			clocks: options.clocks,
			edgeAts: edgeInstants(options.edgeProfiles ?? [profile], options.clocks),
			...(await seedCategories(userId, bobId)),
		},
		options.seed,
	);
}

export async function seedParityLedger(
	options: ParityOptions,
): Promise<ParityLedger> {
	const ctx = await contextOf(options);
	const expenses = await seedExpenses(ctx);
	const accountIds = await seedAccounts(ctx);
	const snapshots = await seedSnapshots(ctx, accountIds);
	const legs = await seedLegs(ctx, accountIds, expenses.legParent);
	const rateSwitches = await seedRateSwitches(ctx, accountIds);
	const templateIds = await seedTemplates(ctx);
	const projects = await seedProjects(ctx);
	const shares = await seedShares(ctx, projects);
	return {
		userId: ctx.userId,
		bobId: ctx.bobId,
		accountIds,
		templateIds,
		expenseIds: expenses.ids,
		hiddenProjectId: projects.hidden,
		counts: {
			expenses: expenses.count,
			categories: ctx.categoryIds.length + 1,
			templates: templateIds.length,
			accounts: accountIds.length,
			snapshots,
			legs,
			rateSwitches,
			shares,
		},
	};
}
