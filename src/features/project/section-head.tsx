import type { ReactNode } from "react";

/**
 * A flat section whose heading row ends with one control (a Segmented, Add
 * person), as the project mockup lays them out. The kit's Section takes
 * only a link there (GAPS, "Section end slot"); this keeps its type,
 * spacing and no-border rules.
 */
export function SectionHead({
	id,
	title,
	count,
	end,
	children,
}: {
	id: string;
	title: string;
	count?: number;
	end?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section aria-labelledby={`${id}-title`} className="mt-8 first:mt-0">
			<div className="min-h-ctl mb-2 flex items-center justify-between gap-3">
				<h2 className="text-fg text-section" id={`${id}-title`}>
					{title}
					{count != null && (
						<span className="text-fg-3 ml-2 font-normal tabular-nums">
							{count}
						</span>
					)}
				</h2>
				{end}
			</div>
			{children}
		</section>
	);
}
