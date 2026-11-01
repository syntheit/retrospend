"use client";

import { DetailPager, type DetailTab } from "~/components/ui/detail-pager";

/**
 * The composer's frame (design D), one for Expense, Income and Transfer:
 * two panes from md up (entry on the left, the detail tabs on the right with
 * each panel in place), one column on a phone (entry, tabs and the swipe row
 * of panels, then what saving changes). Alt+1 to 5 picks a tab from anywhere.
 */
export function ComposerFrame<Id extends string>({
	tabs,
	active,
	onActive,
	label,
	entry,
	changes,
}: {
	tabs: readonly (DetailTab & { id: Id })[];
	active: Id;
	onActive: (id: Id) => void;
	label: string;
	entry: React.ReactNode;
	changes: React.ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Alt+1 to 5 picks a tab from anywhere in the form
		<div
			className="grid gap-4 md:h-full md:grid-cols-5 md:gap-x-6 md:gap-y-4"
			onKeyDown={(e) => {
				if (!e.altKey || e.ctrlKey || e.metaKey) return;
				const n = /^Digit([1-5])$/.exec(e.code)?.[1];
				const hit = n ? tabs[Number(n) - 1] : undefined;
				if (!hit) return;
				e.preventDefault();
				onActive(hit.id);
			}}
		>
			<div className="flex min-w-0 flex-col gap-4 md:col-span-2 md:row-start-1">
				{entry}
			</div>
			<DetailPager
				active={active}
				className="md:bg-raised md:rounded-panel md:col-span-3 md:col-start-3 md:row-span-2 md:row-start-1 md:p-3"
				label={label}
				onActive={(id) => onActive(id as Id)}
				tabs={tabs}
			/>
			<div className="flex min-w-0 flex-col gap-4 md:col-span-2 md:row-start-2 md:self-end">
				{changes}
			</div>
		</div>
	);
}
