import { Fragment, type ReactNode } from "react";
import { cn } from "~/lib/cn";

export type SummaryItem = {
	key: string;
	label: ReactNode;
	/** A Money, Balance or count; it gets fg and weight 600. */
	value: ReactNode;
};

/**
 * SummaryLine (R3): one glance line of key numbers instead of a tile row,
 * "Spent ARS 2,706,602 · Left ARS 59,161". Labels in fg-2, values in fg
 * 600. Every value is a figure the server computed (R9).
 */
export function SummaryLine({
	items,
	className,
}: {
	items: SummaryItem[];
	className?: string;
}) {
	return (
		<p
			className={cn("mb-4 text-body text-fg-2", className)}
			data-slot="summary-line"
		>
			{items.map((item, i) => (
				<Fragment key={item.key}>
					{i > 0 && (
						<span aria-hidden="true" className="mx-2 text-fg-3">
							·
						</span>
					)}
					<span className="whitespace-nowrap">
						{item.label}{" "}
						<span className="font-semibold text-fg tabular-nums">
							{item.value}
						</span>
					</span>
				</Fragment>
			))}
		</p>
	);
}
