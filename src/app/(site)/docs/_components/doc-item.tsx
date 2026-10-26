import type { ReactNode } from "react"

/**
 * One term and what it means, flat: no box around it. The docs pages lay
 * these out in a grid.
 */
export function DocItem({
	title,
	children,
}: {
	title: ReactNode
	children: ReactNode
}) {
	return (
		<div className="py-2">
			<p className="text-fg text-small font-medium">{title}</p>
			<p className="text-fg-2 text-small mt-1">{children}</p>
		</div>
	)
}
