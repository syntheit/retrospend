"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { type ChangeLine, ChangeValue } from "~/components/ui/sheet-changes";
import { type Diff, FigureChanges } from "./figure-changes";
import type { DryRun } from "./use-dry-run";
import type { EnvelopeInGroup } from "./use-month";

type Amount = { minor: number; currency: string };
type Left = readonly { id: string; before: Amount; after: Amount }[];
type Routed = readonly {
	categoryId: string;
	from: string | null;
	to: string | null;
}[];

/** What an envelope edit's preview carries besides the figures. */
export type EditPreview = Diff & {
	value: { left: Left; routed: Routed };
};

/**
 * "What this changes" for an envelope edit (create, edit, combine, archive):
 * every envelope the edit touched with its Left before and after, each
 * category that moved from one envelope to another, then the budget figures
 * as the server says. Names the sheet has not loaded (a new envelope, one
 * combined away) come from `names`.
 */
export function EnvelopeEditChanges<P extends EditPreview>({
	dry,
	byId,
	names = {},
	categoryNames,
	poolName,
	fallbackName,
	done,
	extra,
}: {
	dry: DryRun<P>;
	byId: ReadonlyMap<string, EnvelopeInGroup>;
	/** Names for envelope ids the month does not list (the one being created). */
	names?: Readonly<Record<string, string>>;
	categoryNames: ReadonlyMap<string, string>;
	poolName: string;
	fallbackName: string;
	done?: boolean;
	/** Lines the write states besides these (a combined target, a new name). */
	extra?: (preview: P) => ChangeLine[];
}) {
	const t = useTranslations("budgetSheets.envelopeEdit");
	const name = (id: string | null) =>
		id === null
			? t("noEnvelope")
			: (names[id] ?? byId.get(id)?.name ?? fallbackName);
	return (
		<FigureChanges
			done={done}
			dry={dry}
			own={(p): ChangeLine[] => [
				...(extra ? extra(p) : []),
				...p.value.left.map((e) => ({
					key: e.id,
					label: name(e.id),
					value: (
						<ChangeValue
							from={<Money figure="envelope.left" value={e.before} />}
							to={<Money figure="envelope.left" value={e.after} />}
						/>
					),
				})),
				...p.value.routed.map((r) => ({
					key: `cat-${r.categoryId}`,
					label: categoryNames.get(r.categoryId) ?? fallbackName,
					value: <ChangeValue from={name(r.from)} to={name(r.to)} />,
				})),
			]}
			poolName={poolName}
		/>
	);
}
