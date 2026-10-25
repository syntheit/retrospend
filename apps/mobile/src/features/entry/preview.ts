import type { RetrospendClient } from "@retrospend/api-client";
import type { PendingWrite } from "./draft";

// "What this changes" (R30): the server's dry run of the same write that Save
// makes, so the preview equals the result. This file asks for it and orders
// what comes back; the words and the money formatting are the screen's.

export type PreviewDto = Awaited<
	ReturnType<RetrospendClient["income"]["previewCreate"]>
>;

export type PreviewState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; diff: PreviewDto }
	/** The server could not be reached: the write will wait on the phone. */
	| { status: "offline" }
	/** The server refused the dry run (a missing rate, a bad share). */
	| { status: "refused" };

export async function fetchPreview(
	api: RetrospendClient,
	write: PendingWrite,
): Promise<PreviewState> {
	try {
		const body = write.body;
		const diff =
			write.entity === "expenses"
				? await api.expenses.previewCreate(
						body as Parameters<typeof api.expenses.previewCreate>[0],
					)
				: write.entity === "shared-expenses"
					? await api["shared-expenses"].previewCreate(
							body as Parameters<
								(typeof api)["shared-expenses"]["previewCreate"]
							>[0],
						)
					: await api.income.previewCreate(
							body as Parameters<typeof api.income.previewCreate>[0],
						);
		return { status: "ready", diff };
	} catch (error) {
		// A thrown error without a status never reached the server. A 401 is the
		// session ending; the write waits on the phone for the next sign in.
		const status = (error as { status?: number } | null)?.status;
		return status === undefined || status === 401
			? { status: "offline" }
			: { status: "refused" };
	}
}

/** The order places are listed in, as on the web. */
const ORDER = [
	"accounts.balance",
	"notTracked",
	"owed.owedToYou",
	"owed.youOwe",
	"envelope.left",
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"spent",
	"netWorth",
];
/** Parts of net worth's 30-day breakdown: the net worth line already says it. */
const HIDDEN = /^netWorthChange\./;
/** Budget figures that read nothing on both sides: no envelope budget, not unknown. */
const BUDGET = /^budget\./;

const rank = (id: string) => {
	const i = ORDER.indexOf(id);
	return i < 0 ? ORDER.length : i;
};

export interface ChangeLine {
	key: string;
	figure: string;
	delta: { minor: number; currency: string };
	after: { minor: number; currency: string } | null;
}

export interface ChangeLines {
	/** Places that move, before to after. */
	moved: ChangeLine[];
	/** Places the dry run checked and found unchanged. */
	stays: string[];
	/** Places that could not be read (a missing rate). */
	unknown: string[];
}

/** Percent lines belong to figures these writes never touch; money only. */
const isMoney = (line: { currency: string }) => line.currency !== "%";

export function changeLines(diff: PreviewDto): ChangeLines {
	const moved = diff.changes
		.filter((c) => !HIDDEN.test(c.id) && isMoney(c.delta))
		.slice()
		.sort((a, b) => rank(a.id) - rank(b.id))
		.map((c) => ({
			key: `${c.id}-${c.currency}`,
			figure: c.id,
			delta: c.delta,
			after: c.after,
		}));
	const movedIds = new Set(moved.map((m) => m.figure));
	const stays = diff.unchanged
		.map((u) => (u.id === "accounts.balance" ? "accounts" : u.id))
		.filter((id) => !HIDDEN.test(id) && !movedIds.has(id));
	const unknown = diff.unavailable
		.filter(
			(u) =>
				!HIDDEN.test(u.id) &&
				!(BUDGET.test(u.id) && u.before == null && u.after == null),
		)
		.map((u) => u.id);
	return { moved, stays: [...new Set(stays)], unknown };
}
