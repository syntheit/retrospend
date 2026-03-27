"use client";

import type React from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/components/ui/alert-dialog";

interface ConfirmationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: React.ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	onConfirm: () => void;
	onCancel?: () => void;
	isLoading?: boolean;
	variant?: "default" | "destructive";
}

/**
 * A reusable confirmation dialog component built on AlertDialog.
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
		<AlertDialog onOpenChange={onOpenChange} open={open}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{description && (
						<AlertDialogDescription asChild={typeof description !== "string"}>
							{typeof description === "string" ? description : <div>{description}</div>}
						</AlertDialogDescription>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isLoading} onClick={handleCancel}>
						{cancelLabel}
					</AlertDialogCancel>
					<AlertDialogAction
						className={
							variant === "destructive"
								? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
								: ""
						}
						disabled={isLoading}
						onClick={(e) => {
							e.preventDefault();
							onConfirm();
						}}
					>
						{isLoading ? "Processing..." : confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/**
 * Alias for ConfirmationDialog with alternate prop names.
 * Uses `confirmText`/`cancelText` instead of `confirmLabel`/`cancelLabel`.
 */
export function ConfirmDialog({
	confirmText = "Confirm",
	cancelText = "Cancel",
	...rest
}: Omit<ConfirmationDialogProps, "confirmLabel" | "cancelLabel"> & {
	confirmText?: string;
	cancelText?: string;
}) {
	return (
		<ConfirmationDialog
			confirmLabel={confirmText}
			cancelLabel={cancelText}
			{...rest}
		/>
	);
}
