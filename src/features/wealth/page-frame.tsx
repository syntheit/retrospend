import type { ReactNode } from "react";

/**
 * The scrolling column a v2 page sits in inside the shell's main: the kit's
 * `.page` (1120 max, gutter sides). `data-ui="v2"` marks the page for the
 * e2e audits. The kit has no page container yet, so the Wealth and
 * Currencies pages share this one (reported as a kit gap).
 */
export function PageFrame({
	children,
	label,
}: {
	children: ReactNode;
	/** Names the page for the audits ("wealth"). */
	label: string;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
			<div
				className="px-gutter mx-auto w-full max-w-280 pt-6 pb-12"
				data-page={label}
				data-ui="v2"
			>
				{children}
			</div>
		</div>
	);
}
