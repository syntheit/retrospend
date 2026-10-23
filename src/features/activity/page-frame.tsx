import type { ReactNode } from "react";

/**
 * The v2 page frame (kit `.main` + `.page`): the scroll area inside the
 * shell's main, and the content column, 1120px at most (size.page-max),
 * centered, with the gutter at the sides. The kit has no React part for it
 * yet (reported as a kit gap), so Activity and Recurring share this one.
 */
export function PageFrame({
	children,
	...data
}: { children: ReactNode } & Record<`data-${string}`, string>) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="px-gutter mx-auto max-w-280 pt-6 pb-12" {...data}>
				{children}
			</div>
		</div>
	);
}
