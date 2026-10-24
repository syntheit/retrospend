"use client";

import { Money } from "~/components/money/money";
import { type ChangeLine, ChangeValue } from "~/components/ui/sheet-changes";
import { FigureChanges } from "./figure-changes";
import type { DryRun } from "./use-dry-run";
import type { EnvelopeInGroup } from "./use-month";

type Amount = { minor: number; currency: string };

/** A write that moved money between envelopes (the movement kinds' result). */
type MovementPreview = {
	changes: readonly {
		id: string;
		currency: string;
		before: Amount | null;
		after: Amount | null;
	}[];
	unchanged: readonly { id: string }[];
	unavailable: readonly { id: string }[];
	value: {
		envelopes: readonly { id: string; before: Amount; after: Amount }[];
	};
};

/**
 * "What this changes" for a write that moves money between envelopes: each
 * envelope it moved with its Left before and after, then To assign and Left
 * to spend as the server's figures say, then what stays. `fallbackName`
 * names an envelope the sheet has not loaded (archived since).
 */
export function MovementChanges<P extends MovementPreview>({
	dry,
	byId,
	poolName,
	fallbackName,
	done,
}: {
	dry: DryRun<P>;
	byId: ReadonlyMap<string, EnvelopeInGroup>;
	poolName: string;
	fallbackName: string;
	done?: boolean;
}) {
	return (
		<FigureChanges
			done={done}
			dry={dry}
			own={(p): ChangeLine[] =>
				p.value.envelopes.map((e) => ({
					key: e.id,
					label: byId.get(e.id)?.name ?? fallbackName,
					value: (
						<ChangeValue
							from={<Money figure="envelope.left" value={e.before} />}
							to={<Money figure="envelope.left" value={e.after} />}
						/>
					),
				}))
			}
			poolName={poolName}
		/>
	);
}
