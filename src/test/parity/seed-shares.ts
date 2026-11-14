/**
 * The shared expenses of the parity ledger (E2EE P16): Bob's (and the user's
 * own) expenses with the user in them. Every status, with and without a
 * captured rate, one project the user hides from reports and one they show, a
 * guest beside the user, expenses the user paid, corrections with negative
 * shares, and, for the profile with a currency of no rate, unpriced shares in
 * each clock's period. Money is seeded as minor units turned into text.
 */
import { randomUUID } from "node:crypto";
import { columnText } from "@retrospend/domain/money-dec";
import type { Prisma } from "~prisma";
import { adminDb, fixtureDb } from "../pg-harness";
import { seedRate } from "./rates";
import { D, DAY, MINUTE, type SeedContext, text } from "./seed-context";

const STATUSES = [
	"PENDING",
	"ACCEPTED",
	"REJECTED",
	"AUTO_ACCEPTED",
	"ACCEPTED",
] as const;
type Status = (typeof STATUSES)[number];
const SHARE_CURRENCIES = ["ARS", "USD", "JPY", "ARS", "USD"] as const;

export interface Projects {
	hidden: string;
	shown: string;
}

/** Two projects Bob made, the user in both: one hidden from reports, one not. */
export async function seedProjects(ctx: SeedContext): Promise<Projects> {
	const project = async (name: string) =>
		(
			await fixtureDb.project.create({
				data: { name, createdById: ctx.bobId, primaryCurrency: "ARS" },
			})
		).id;
	const hidden = await project("Hidden");
	const shown = await project("Shown");
	await adminDb.projectParticipant.createMany({
		data: [
			[hidden, true],
			[shown, false],
		].map(([projectId, exclude]) => ({
			projectId: projectId as string,
			participantType: "user" as const,
			participantId: ctx.userId,
			excludeFromAnalytics: exclude as boolean,
		})),
	});
	return { hidden, shown };
}

interface ShareSpec {
	minor: number;
	currency: string;
	at: Date;
	status: Status;
	rate: boolean;
	projectId?: string;
	guest?: boolean;
	paidByYou?: boolean;
	categoryId?: string;
	correctsId?: string;
}

/** Collects shared transactions and their participants; one call is one shared expense. */
function shareBuilder(ctx: SeedContext) {
	const txs: Prisma.SharedTransactionCreateManyInput[] = [];
	const parts: Prisma.SplitParticipantCreateManyInput[] = [];
	const participant = (
		transactionId: string,
		type: "user" | "guest",
		participantId: string,
		minor: number,
		currency: string,
		status: Status,
	) =>
		parts.push({
			id: randomUUID(),
			transactionId,
			participantType: type,
			participantId,
			shareAmount: D(text(minor, currency)),
			verificationStatus: status,
		});
	const add = (o: ShareSpec): string => {
		const id = randomUUID();
		const others = o.guest ? Math.floor(o.minor / 2) : 0;
		const payer = o.paidByYou ? ctx.userId : ctx.bobId;
		txs.push({
			id,
			description: `shared ${txs.length}`,
			amount: D(text(Math.abs(o.minor) + others, o.currency)),
			currency: o.currency,
			date: o.at,
			exchangeRate: o.rate
				? D(columnText(seedRate(o.currency, "official", o.at) ?? "1", 6))
				: null,
			projectId: o.projectId ?? null,
			categoryId: o.categoryId ?? null,
			correctsId: o.correctsId ?? null,
			paidByType: "user",
			paidById: payer,
			createdByType: "user",
			createdById: payer,
		});
		// A correction holds only the difference, so it is negative for the user.
		const mine = o.correctsId ? -Math.abs(o.minor) : o.minor;
		participant(id, "user", ctx.userId, mine, o.currency, o.status);
		if (o.paidByYou)
			participant(
				id,
				"user",
				ctx.bobId,
				Math.abs(o.minor),
				o.currency,
				"ACCEPTED",
			);
		if (o.guest)
			participant(id, "guest", randomUUID(), others, o.currency, "PENDING");
		return id;
	};
	return { txs, parts, add };
}

/** The i-th share: its position decides status, rate, project, guest, payer and category. */
function shareSpec(ctx: SeedContext, i: number, projects: Projects): ShareSpec {
	const currency = SHARE_CURRENCIES[i % SHARE_CURRENCIES.length] as string;
	const atEdge = i < ctx.edgeAts.length / 2 && i % 2 === 0;
	return {
		minor: ctx.amountOf(currency),
		currency,
		at: atEdge ? (ctx.edgeAts[i] as Date) : ctx.dateOf(),
		status: STATUSES[i % STATUSES.length] as Status,
		rate: i % 2 === 0,
		projectId:
			i % 7 === 3 ? projects.hidden : i % 7 === 5 ? projects.shown : undefined,
		guest: i % 5 === 2,
		paidByYou: i % 6 === 4,
		categoryId:
			i % 4 === 1
				? ctx.bobCategory
				: i % 4 === 3
					? ctx.pick(ctx.categoryIds)
					: undefined,
	};
}

/** Returns how many participations are the user's. */
export async function seedShares(
	ctx: SeedContext,
	projects: Projects,
): Promise<number> {
	const { txs, parts, add } = shareBuilder(ctx);
	let last: string | null = null;
	for (let i = 0; i < ctx.size.shares; i++) {
		const spec = shareSpec(ctx, i, projects);
		const id = add(spec);
		// A correction of the share before it.
		if (i % 11 === 10 && last)
			add({
				minor: Math.max(1, ctx.amountOf(spec.currency) % 5000),
				currency: spec.currency,
				at: ctx.dateOf(),
				status: "ACCEPTED",
				rate: false,
				correctsId: last,
			});
		last = id;
	}
	// An unpriced share a minute and a day before each instant, so this period and the last
	// both have one whatever the zone (2027-01-01T03:30Z is 00:30 on January 1 in Buenos Aires).
	if (ctx.profile.withMissingRate)
		for (const clock of ctx.clocks)
			for (const back of [MINUTE, DAY])
				add({
					minor: 1234,
					currency: "XQZ",
					at: new Date(clock.getTime() - back),
					status: "ACCEPTED",
					rate: false,
				});
	await fixtureDb.sharedTransaction.createMany({ data: txs });
	await adminDb.splitParticipant.createMany({ data: parts });
	return parts.filter((p) => p.participantId === ctx.userId).length;
}

/**
 * A shared expense in a currency no rate exists for, with the user in it. A
 * share is priced from the rate table (an expense carries its own USD value),
 * so this is what makes spending and Owed to you unavailable on both sides.
 * Returns its id for `dropUnpricedShare`.
 */
export async function addUnpricedShare(
	userId: string,
	bobId: string,
	at: Date,
): Promise<string> {
	const id = randomUUID();
	await fixtureDb.sharedTransaction.create({
		data: {
			id,
			description: "no rate",
			amount: D("12.34"),
			currency: "XQZ",
			date: at,
			paidByType: "user",
			paidById: bobId,
			createdByType: "user",
			createdById: bobId,
			splitParticipants: {
				create: {
					id: randomUUID(),
					participantType: "user",
					participantId: userId,
					shareAmount: D("12.34"),
					verificationStatus: "ACCEPTED",
				},
			},
		},
	});
	return id;
}

export async function dropUnpricedShare(id: string): Promise<void> {
	await fixtureDb.sharedTransaction.delete({ where: { id } });
}
