import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

const TONE = {
	neutral: "text-fg",
	positive: "text-positive",
	danger: "text-danger",
	attention: "text-attention-text",
} as const;

/**
 * The layout of a sign-in, sign-up or link-landing page: a title, one line
 * under it, then the form or the next step. Flat, no box around it. A result
 * page (verified, failed, expired) sets `tone`: the title takes that color and
 * says the result in words, so color is never the only signal.
 */
export function AuthPanel({
	title,
	description,
	tone = "neutral",
	busy,
	children,
	className,
}: {
	title?: ReactNode;
	description?: ReactNode;
	tone?: keyof typeof TONE;
	/** The result is still loading. */
	busy?: boolean;
	children?: ReactNode;
	/** Layout of the body (centered actions, stacked form). */
	className?: string;
}) {
	return (
		<div aria-busy={busy || undefined} className="w-full max-w-md">
			{title ? (
				<h1 className={cn("text-title text-center", TONE[tone])}>{title}</h1>
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
