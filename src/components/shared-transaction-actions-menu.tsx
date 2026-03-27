"use client";

import { Check, Edit2, History, MoreHorizontal, Trash2, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

interface SharedTransactionActionsMenuProps {
	canEdit: boolean;
	canDelete: boolean;
	isLocked?: boolean;
	/** Show Accept/Reject when the current user has a PENDING split */
	isPendingReview?: boolean;
	onAccept?: () => void;
	onReject?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onViewHistory?: () => void;
	triggerClassName?: string;
}

export function SharedTransactionActionsMenu({
	canEdit,
	canDelete,
	isLocked,
	isPendingReview,
	onAccept,
	onReject,
	onEdit,
	onDelete,
	onViewHistory,
	triggerClassName,
}: SharedTransactionActionsMenuProps) {
	// Don't show the menu if the user has no permissions and the tx is not locked
	if (!canEdit && !canDelete && !isLocked && !isPendingReview) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					className={cn("h-7 w-7", triggerClassName)}
					size="icon"
					variant="ghost"
				>
					<MoreHorizontal className="h-4 w-4" />
					<span className="sr-only">Actions</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				{onViewHistory && (
					<>
						<DropdownMenuItem onClick={onViewHistory}>
							<History className="mr-2 h-4 w-4" />
							View history
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				)}
				{isPendingReview && onAccept && onReject && (
					<>
						<DropdownMenuItem onClick={onAccept}>
							<Check className="mr-2 h-4 w-4 text-emerald-500" />
							Accept
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onReject}>
							<X className="mr-2 h-4 w-4 text-rose-500" />
							Reject
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuItem
					className={
						!canEdit
							? "cursor-not-allowed text-muted-foreground focus:text-muted-foreground"
							: ""
					}
					disabled={!canEdit}
					onClick={canEdit ? onEdit : undefined}
					title={isLocked ? "Settled transactions cannot be edited" : undefined}
				>
					<Edit2 className="mr-2 h-4 w-4" />
					Edit
				</DropdownMenuItem>
				<DropdownMenuItem
					className={
						!canDelete
							? "cursor-not-allowed text-muted-foreground focus:text-muted-foreground"
							: undefined
					}
					disabled={!canDelete}
					onClick={canDelete ? onDelete : undefined}
					title={
						isLocked ? "Settled transactions cannot be deleted" : undefined
					}
					variant={canDelete ? "destructive" : undefined}
				>
					<Trash2 className="mr-2 h-4 w-4" />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
