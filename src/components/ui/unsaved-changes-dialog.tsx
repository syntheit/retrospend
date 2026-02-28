"use client";

import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";

interface UnsavedChangesDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDiscard: () => void;
	onStay: () => void;
	title?: string;
	description?: string;
}

export function UnsavedChangesDialog({
	open,
	onOpenChange,
	onDiscard,
	onStay,
	title = "Unsaved Changes",
	description = "You have unsaved changes. Are you sure you want to leave? All changes will be lost.",
}: UnsavedChangesDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col gap-2 sm:flex-row">
					<Button onClick={onStay} variant="ghost">
						Stay on Page
					</Button>
					<Button onClick={onDiscard} variant="destructive">
						Discard Changes
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
