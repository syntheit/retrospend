"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { formatRelativeTime } from "~/lib/format";

interface TransactionEditedIndicatorProps {
	editCount: number;
	lastEditedBy: string | null;
	lastEditedAt: string | null;
	hasUnseenChanges?: boolean;
	onClick: () => void;
}

export function TransactionEditedIndicator({
	editCount,
	lastEditedBy,
	lastEditedAt,
	hasUnseenChanges = false,
	onClick,
}: TransactionEditedIndicatorProps) {
	const [seenLocally, setSeenLocally] = useState(false);

	const showDot = hasUnseenChanges && !seenLocally;

	if (editCount === 0 && !showDot) return null;

	const tooltipText = showDot
		? lastEditedBy && lastEditedAt
			? `Changed by ${lastEditedBy}, ${formatRelativeTime(lastEditedAt)}. Click to see what's different.`
			: "This expense was changed. Click to see what's different."
		: lastEditedBy && lastEditedAt
			? `Last edited by ${lastEditedBy}, ${formatRelativeTime(lastEditedAt)}. Click to view history.`
			: "Click to view revision history.";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					className="inline-flex h-auto items-center gap-1 p-0 font-medium text-muted-foreground text-xs hover:text-foreground hover:underline"
					onClick={(e) => {
						e.stopPropagation();
						setSeenLocally(true);
						onClick();
					}}
					type="button"
					variant="ghost"
				>
					{showDot && (
						<span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
					)}
					{editCount > 0 && (
						<>
							<Pencil className="h-3.5 w-3.5" />
							<span>
								{editCount === 1 ? "Edited" : `Edited \u00d7${editCount}`}
							</span>
						</>
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{tooltipText}</TooltipContent>
		</Tooltip>
	);
}
