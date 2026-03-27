"use client";

import { useEffect, useRef, useState } from "react";

import { ExpenseForm, type ExpenseFormHandle } from "~/components/expense-form";
import type { ExpenseInitialValues } from "~/hooks/use-expense-form";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";

interface ExpenseModalProps {
	expenseId: string;
	sharedTransactionId?: string;
	mode?: "create" | "edit";
	title?: string;
	description?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onSaveAndNew?: () => void;
	projectId?: string;
	projectDefaultCurrency?: string;
	isSolo?: boolean;
	initialValues?: ExpenseInitialValues;
	stickyDefaults?: { currency?: string };
	currentParticipant?: {
		participantType: "user" | "guest" | "shadow";
		participantId: string;
		name?: string;
	};
}

export function ExpenseModal({
	expenseId,
	sharedTransactionId,
	mode = "edit",
	title = "New Expense",
	open: controlledOpen,
	onOpenChange,
	onSaveAndNew,
	projectId,
	projectDefaultCurrency,
	isSolo,
	initialValues,
	stickyDefaults,
	currentParticipant,
}: ExpenseModalProps) {
	const [internalOpen, setInternalOpen] = useState(true);
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;
	const formRef = useRef<ExpenseFormHandle>(null);
	const [dynamicTitle, setDynamicTitle] = useState(title);

	// Sync with prop changes (e.g., save-and-new resets the title)
	useEffect(() => {
		setDynamicTitle(title);
	}, [title]);

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

	const handleTitleChange = (newTitle: string) => {
		setDynamicTitle(newTitle || title);
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogContent
				className="top-4 left-1/2 flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] translate-x-[-50%] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90dvh] sm:w-full sm:max-w-xl sm:-translate-y-1/2"
				onOpenAutoFocus={(e) => {
					// Prevent autofocus on mobile to avoid keyboard popup covering the form
					if (window.innerWidth < 640) {
						e.preventDefault();
					}
				}}
			>
				<DialogHeader className="shrink-0 px-4 pt-5 pb-0 sm:px-6 sm:pt-6">
					<div className="flex min-w-0 items-center justify-between gap-2">
						<DialogTitle className="min-w-0 truncate" title={dynamicTitle}>{dynamicTitle}</DialogTitle>
					</div>
					<DialogDescription className="sr-only">Add or edit an expense</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<ExpenseForm
						key={expenseId}
						expenseId={expenseId}
						sharedTransactionId={sharedTransactionId}
						isSolo={isSolo}
						isModal
						mode={mode}
						onClose={handleClose}
						onSaveAndNew={onSaveAndNew}
						onTitleChange={handleTitleChange}
						projectId={projectId}
						projectDefaultCurrency={projectDefaultCurrency}
						initialValues={initialValues}
						stickyDefaults={stickyDefaults}
						currentParticipant={currentParticipant}
						ref={formRef}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
