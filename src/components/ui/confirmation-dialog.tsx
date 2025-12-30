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

interface ConfirmationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	onConfirm: () => void;
	onCancel?: () => void;
	isLoading?: boolean;
	variant?: "default" | "destructive";
}

/**
 * A reusable confirmation dialog component.
 *
 * @example
 * ```tsx
 * <ConfirmationDialog
 *   open={showDeleteDialog}
 *   onOpenChange={setShowDeleteDialog}
 *   title="Delete Item"
 *   description="Are you sure? This action cannot be undone."
 *   confirmLabel="Delete"
 *   variant="destructive"
 *   onConfirm={handleDelete}
 *   isLoading={isDeleting}
 * />
 * ```
 */
export function ConfirmationDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	onConfirm,
	onCancel,
	isLoading = false,
	variant = "default",
}: ConfirmationDialogProps) {
	const handleCancel = () => {
		onCancel?.();
		onOpenChange(false);
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button disabled={isLoading} onClick={handleCancel} variant="outline">
						{cancelLabel}
					</Button>
					<Button disabled={isLoading} onClick={onConfirm} variant={variant}>
						{isLoading ? "Processing..." : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
