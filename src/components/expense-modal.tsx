"use client";

import { useRef, useState } from "react";

import { ExpenseForm, type ExpenseFormHandle } from "~/components/expense-form";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";

interface ExpenseModalProps {
	expenseId: string;
	mode?: "create" | "edit";
	title?: string;
	description?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

export function ExpenseModal({
	expenseId,
	mode = "edit",
	title = "New Expense",
	description = "Fill in the details for your expense. You can save it as a draft to continue later or finalize it now.",
	open: controlledOpen,
	onOpenChange,
}: ExpenseModalProps) {
	const [internalOpen, setInternalOpen] = useState(true);
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;
	const formRef = useRef<ExpenseFormHandle>(null);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && formRef.current?.hasUnsavedChanges()) {
			formRef.current.triggerUnsavedDialog();
			return;
		}

		if (!isControlled) {
			setInternalOpen(nextOpen);
		}
		onOpenChange?.(nextOpen);
	};

	const handleClose = () => handleOpenChange(false);

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogContent
				className="top-4 left-1/2 h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] translate-x-[-50%] translate-y-0 overflow-y-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-none sm:w-full sm:max-w-3xl sm:-translate-y-1/2"
				onOpenAutoFocus={(e) => {
					// Prevent autofocus on mobile to avoid keyboard popup covering the form
					if (window.innerWidth < 640) {
						e.preventDefault();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<ExpenseForm
					expenseId={expenseId}
					isModal
					mode={mode}
					onClose={handleClose}
					ref={formRef}
				/>
			</DialogContent>
		</Dialog>
	);
}
