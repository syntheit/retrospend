import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * The page-wide layout of a sign-in, sign-up or link-landing page: a title,
 * one line under it, then the form or the result. Flat, no box around it.
 */
export function AuthPanel({
	title,
	description,
	children,
	className,
}: {
	title?: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	/** Layout of the body (centered result, stacked form). */
	className?: string;
}) {
	return (
		<div className="w-full max-w-md">
			{title ? (
				<h1 className="text-fg text-title text-center">{title}</h1>
			) : null}
			{description ? (
				<p className="text-fg-2 text-body mt-2 text-center">{description}</p>
			) : null}
			{children ? (
				<div className={cn(title ? "mt-6" : "", className)}>{children}</div>
			) : null}
		</div>
	);
}
