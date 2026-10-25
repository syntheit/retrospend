"use client";

import { Money } from "~/components/money/money";
import { type ChangeLine, ChangeValue } from "~/components/ui/sheet-changes";
import { type Diff, FigureChanges } from "./figure-changes";
import type { DryRun } from "./use-dry-run";
import type { EnvelopeInGroup } from "./use-month";

type Amount = { minor: number; currency: string };
type Moved = readonly { id: string; before: Amount; after: Amount }[];

/**
 * "What this changes" for a write that moves money between envelopes: each
 * envelope it moved with its Left before and after, then To assign and Left
 * to spend as the server's figures say, then what stays. `fallbackName`
 * names an envelope the sheet has not loaded (archived since). `moved` says
 * where the preview keeps the moved envelopes (default: a movement result's
 * own `value.envelopes`).
 */
export function MovementChanges<P extends Diff>({
	dry,
	byId,
	poolName,
	fallbackName,
	done,
	moved = (p) =>
		(p as unknown as { value: { envelopes: Moved } }).value.envelopes,
}: {
	dry: DryRun<P>;
	byId: ReadonlyMap<string, EnvelopeInGroup>;
	poolName: string;
	fallbackName: string;
	done?: boolean;
	moved?: (preview: P) => Moved;
}) {
	return (
		<FigureChanges
			done={done}
			dry={dry}
			own={(p): ChangeLine[] =>
				moved(p).map((e) => ({
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
