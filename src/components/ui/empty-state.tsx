import type { LucideIcon } from "lucide-react";
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
