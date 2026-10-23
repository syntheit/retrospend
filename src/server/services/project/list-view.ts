/**
 * The Projects list (uiV2): one row per project the user is in, with the
 * project's own figures in minor units. Every number comes from the same
 * reads as the project page (readProjectNumbers), so the list and the
 * Summary tab cannot disagree: the group total is `project.total`, your
 * share and your balance are your `project.member.share` and
 * `project.member.balance` lines.
 */

import { getImageUrl } from "~/lib/image-url";
import type { Money } from "~/server/figures/registry";
import type { PrismaClient } from "~prisma";
import { batchResolveIdentities } from "./identities";
import { readProjectNumbers } from "./numbers";
import { budgetOf, type ProjectBudget } from "./page-figures";
import { refKey } from "./summary";

export interface ListPerson {
	/** `<participantType>:<participantId>`, as summary.refKey. */
	id: string;
	name: string;
	imageUrl: string | null;
}

export interface ProjectListItem {
	id: string;
	name: string;
	imageUrl: string | null;
	status: "ACTIVE" | "ARCHIVED";
	/** The project's own currency, the one a row shows first. */
	currency: string;
	/** Your role: only an owner archives, restores or deletes. */
	myRole: "ORGANIZER" | "EDITOR" | "CONTRIBUTOR" | "VIEWER" | null;
	/** Nobody else in the project. */
	solo: boolean;
	/** The other members, in join order. */
	people: ListPerson[];
	/** Everyone, you included. */
	peopleCount: number;
	expenseCount: number;
	/** The first and last expense days (YYYY-MM-DD); a project has no dates of its own yet. */
	firstExpense: string | null;
	lastExpense: string | null;
	/** The year an archived project is listed under: its last expense, or when it changed. */
	year: number;
	/** Every expense, per currency (`project.total`). */
	total: Money[];
	/** Your shares (`project.member.share` for you). */
	myShare: Money[];
	/** Paid − Share − Received + Sent for you (`project.member.balance`): positive, the group owes you. */
	myBalance: Money[];
	budget: ProjectBudget | null;
}

const day = (d: Date | null | undefined) =>
	d ? d.toISOString().slice(0, 10) : null;

function findMine(db: PrismaClient, userId: string) {
	return db.project.findMany({
		where: {
			participants: {
				some: { participantType: "user", participantId: userId },
			},
		},
		select: {
			id: true,
			name: true,
			imagePath: true,
			status: true,
			budgetAmount: true,
			budgetCurrency: true,
			primaryCurrency: true,
			updatedAt: true,
			participants: {
				select: { participantType: true, participantId: true, role: true },
				orderBy: { joinedAt: "asc" },
			},
		},
		orderBy: { updatedAt: "desc" },
	});
}

async function expenseSpans(db: PrismaClient, ids: string[]) {
	if (ids.length === 0) return new Map();
	const rows = await db.sharedTransaction.groupBy({
		by: ["projectId"],
		where: { projectId: { in: ids } },
		_min: { date: true },
		_max: { date: true },
		_count: { _all: true },
	});
	return new Map(rows.map((r) => [r.projectId, r]));
}

const lineOf = (
	members: Awaited<ReturnType<typeof readProjectNumbers>>["members"],
	key: string,
	field: "share" | "balance",
): Money[] =>
	(members.find((m) => m.key === key)?.lines ?? []).map((l) => ({
		minor: l[field],
		currency: l.currency,
	}));

/** Every project the user is in, newest change first. Callers pass the RLS-scoped db. */
export async function readProjectList(
	db: PrismaClient,
	userId: string,
): Promise<ProjectListItem[]> {
	const projects = await findMine(db, userId);
	const me = `user:${userId}`;
	const [spans, people, numbers] = await Promise.all([
		expenseSpans(
			db,
			projects.map((p) => p.id),
		),
		batchResolveIdentities(
			db,
			projects.flatMap((p) => p.participants),
		),
		Promise.all(
			projects.map((p) =>
				readProjectNumbers(db, p.id, {
					participantType: "user",
					participantId: userId,
				}),
			),
		),
	]);

	return projects.map((p, i) => {
		const n = numbers[i] as Awaited<ReturnType<typeof readProjectNumbers>>;
		const span = spans.get(p.id);
		const others = p.participants
			.map(refKey)
			.filter((key) => key !== me)
			.map((key) => ({
				id: key,
				name: people.get(key)?.name ?? "Unknown",
				imageUrl: people.get(key)?.avatarUrl ?? null,
			}));
		const last = day(span?._max.date);
		return {
			id: p.id,
			name: p.name,
			imageUrl: getImageUrl(p.imagePath),
			status: p.status,
			currency: p.primaryCurrency,
			myRole: p.participants.find((pp) => refKey(pp) === me)?.role ?? null,
			solo: others.length === 0,
			people: others,
			peopleCount: p.participants.length,
			expenseCount: span?._count._all ?? 0,
			firstExpense: day(span?._min.date),
			lastExpense: last,
			year: Number((last ?? p.updatedAt.toISOString()).slice(0, 4)),
			total: n.total,
			myShare: lineOf(n.members, me, "share"),
			myBalance: lineOf(n.members, me, "balance"),
			budget: budgetOf(p, n.total),
		};
	});
}
