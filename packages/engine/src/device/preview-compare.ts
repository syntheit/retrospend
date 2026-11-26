import type { FiguresDiff } from "@retrospend/domain/figures/diff";
import { MissingRateError } from "@retrospend/domain/money";
import type { WriteFn } from "../local-db";
import type { Store } from "../port";
import { createDevicePreviewRunner, deviceMutation } from "../preview";
import { deviceFigures } from "../registry";
import type { WriteVerdict } from "../write-parity";
import {
	isDeviceRefusal,
	planOf,
	targetOf,
	type WriteCursors,
	type WriteOp,
} from "./book";
import { countsInOverlay, type PendingEntry } from "./pending";

// The device preview of a save, held against the server's dry run of it. The
// screen keeps showing the server's diff; this only says whether the device
// would have shown the same (ids and figure names, never an amount).

/** What the compare reads of the server's preview (the contract's PreviewResult). */
export interface ServerPreview {
	readonly changes: readonly {
		readonly id: string;
		readonly currency: string;
		readonly delta: { readonly minor: number };
	}[];
	readonly unchanged: readonly { readonly id: string }[];
	readonly unavailable: readonly { readonly id: string }[];
}

/** One figure as a comparable text: its id and each currency's delta, in currency order. */
function lines(
	changes: readonly {
		id: string;
		currency: string;
		delta: { minor: number };
	}[],
	id: string,
) {
	return changes
		.filter((c) => c.id === id)
		.map((c) => `${c.currency}:${c.delta.minor}`)
		.sort()
		.join(",");
}

/**
 * The figures the device and the server both read and disagree on. A figure
 * either side could not read, or the server did not report, is left out: a
 * missing side is not a difference.
 */
export function differingFigures(
	device: FiguresDiff,
	server: ServerPreview,
): string[] {
	const unreadable = new Set(
		[...device.unavailable, ...server.unavailable].map((f) => f.id),
	);
	const known = new Set(
		[...server.changes, ...server.unchanged].map((f) => f.id),
	);
	const ids = new Set(
		[...device.changes, ...device.unchanged].map((f) => f.id),
	);
	return [...ids].filter(
		(id) =>
			known.has(id) &&
			!unreadable.has(id) &&
			lines(device.changes, id) !== lines(server.changes, id),
	);
}

export interface PreviewCompareDeps {
	store: Store;
	userId: string;
	cursors: WriteCursors;
	entries: readonly PendingEntry[];
	/** The latest finished pull, as `countsInOverlay` reads it. */
	settledPull: number;
	now: () => Date;
}

/**
 * Runs the device preview of the write `plan` names over the store as the last
 * pull left it and compares it with `server`: the one owner of the runner, the
 * `pending_ahead` rule and the refusal verdicts, for a save and for a bulk
 * action. While an entry the server has not shown back (unsent, or acked and
 * not pulled) touches any of `ids`, the two start from different rows, so
 * nothing is compared: `pending_ahead`. The verdict is named by the first id.
 */
export async function previewVerdict(
	deps: PreviewCompareDeps,
	ids: readonly string[],
	plan: () => {
		id: string;
		touches: readonly string[];
		write: WriteFn<unknown>;
	},
	server: ServerPreview,
): Promise<WriteVerdict> {
	const id = ids[0] ?? "";
	if (
		deps.entries.some(
			(e) =>
				countsInOverlay(e, deps.settledPull) &&
				e.changes.some((c) => ids.includes(c.id)),
		)
	)
		return { id, outcome: "skipped", code: "pending_ahead" };
	try {
		const { id: mutationId, touches, write } = plan();
		const runner = createDevicePreviewRunner({
			store: deps.store,
			figures: deviceFigures({ clock: deps.now }),
			actor: { userId: deps.userId },
		});
		const diff = await runner.preview(
			deviceMutation<void, unknown>({
				id: mutationId,
				touches,
				write: () => write,
			}),
			undefined,
		);
		const fields = differingFigures(diff, server);
		return fields.length === 0
			? { id, outcome: "match" }
			: { id, outcome: "differs", fields };
	} catch (error) {
		if (error instanceof MissingRateError)
			return { id, outcome: "rate_missing" };
		if (isDeviceRefusal(error)) return { id, outcome: "refused" };
		throw error;
	}
}

/** The device preview of a save, held against the server's dry run of it. */
export const comparePreview = (
	deps: PreviewCompareDeps,
	op: WriteOp,
	server: ServerPreview,
): Promise<WriteVerdict> =>
	previewVerdict(
		deps,
		[targetOf(op)],
		() => planOf(op, deps.store.snapshot(), deps.cursors, deps.now()),
		server,
	);
