import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface EmptyStateAction {
	label: string;
	onClick?: () => void;
	href?: string;
	variant?: "default" | "secondary" | "outline" | "ghost";
}

interface EmptyStateProps {
	icon: LucideIcon;
	title: string;
	description: string;
	action?: EmptyStateAction;
	secondaryAction?: EmptyStateAction;
	className?: string;
}

/**
 * The design's empty state (R14): one line, an optional hint, at most one
 * action ("No expenses yet" [Add expense]; filtered: "No matches" [Clear
 * filters]). A small fg-3 glyph, no illustration, no circle. EmptyState
 * below keeps the old look for today's pages.
 */
export function Empty({
	icon: Icon,
	title,
	hint,
	action,
	className,
}: {
	icon?: LucideIcon;
	title: string;
	hint?: string;
	/** One Button (secondary, size sm). */
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center gap-2 px-6 py-12 text-center",
				className,
			)}
		>
			{Icon && <Icon aria-hidden="true" className="size-6 text-fg-3" />}
			<p className="font-semibold text-body text-fg">{title}</p>
			{hint && <p className="max-w-80 text-fg-2 text-small">{hint}</p>}
			{action}
		</div>
	);
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	secondaryAction,
	className,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center py-12 text-center",
				className,
			)}
		>
			<div className="mb-4 rounded-full bg-muted/50 p-3">
				<Icon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
			</div>
			<h3 className="font-medium text-foreground text-lg">{title}</h3>
			<p className="mt-1 max-w-[300px] text-muted-foreground text-sm">
				{description}
			</p>
			{(action || secondaryAction) && (
				<div className="mt-4 flex flex-wrap items-center justify-center gap-2">
					{action && (
						<Button
							onClick={action.onClick}
							variant={action.variant ?? "default"}
						>
							{action.label}
						</Button>
					)}
					{secondaryAction && (
						<Button
							onClick={secondaryAction.onClick}
							variant={secondaryAction.variant ?? "outline"}
						>
							{secondaryAction.label}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
