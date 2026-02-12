"use client";

import { Trash2, Undo2 } from "lucide-react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Form } from "~/components/ui/form";
import { RateSelector } from "~/components/ui/rate-selector";
import { useExpenseForm } from "~/hooks/use-expense-form";
import { AmortizationSection } from "./expense/form-sections/AmortizationSection";
import { AmountSection } from "./expense/form-sections/AmountSection";
import { CurrencyContextSection } from "./expense/form-sections/CurrencyContextSection";
import { DetailsSection } from "./expense/form-sections/DetailsSection";

interface ExpenseFormProps {
	expenseId: string;
	onTitleChange?: (title: string) => void;
	isModal?: boolean;
	onClose?: () => void;
}

export interface ExpenseFormHandle {
	hasUnsavedChanges: () => boolean;
	triggerUnsavedDialog: () => void;
}

export const ExpenseForm = forwardRef<ExpenseFormHandle, ExpenseFormProps>(
	({ expenseId, onTitleChange, isModal = false, onClose }, ref) => {
		const {
			form,
			onSubmit,
			handleAmountChange,
			handleCurrencyChange,
			handleExchangeRateChange,
			handleTitleBlur,
			handleDelete,
			handleUndoChanges,
			handleDiscardChanges,
			isLoading,
			isSubmitting,
			isDeleting,
			hasUnsavedChanges,
			hasUnsavedChangesRef,
			showUnsavedDialog,
			setShowUnsavedDialog,
			isCustomRateSet,
			setIsCustomRateSet,
			categories,
			homeCurrency,
			expense,
		} = useExpenseForm({ expenseId, isModal, onClose, onTitleChange });

		const [showDeleteDialog, setShowDeleteDialog] = useState(false);
		const [showCustomRateDialog, setShowCustomRateDialog] = useState(false);

		useImperativeHandle(
			ref,
			() => ({
				hasUnsavedChanges: () => hasUnsavedChangesRef.current,
				triggerUnsavedDialog: () => {
					setShowUnsavedDialog(true);
				},
			}),
			[hasUnsavedChangesRef, setShowUnsavedDialog],
		);

		if (isLoading) {
			return <div className="p-4">Loading...</div>;
		}

		return (
			<>
				<Form {...form}>
					<form
						className="space-y-4 sm:space-y-6"
						onSubmit={form.handleSubmit(onSubmit)}
					>
						<AmountSection
							handleAmountChange={handleAmountChange}
							handleCurrencyChange={handleCurrencyChange}
						/>

						<DetailsSection
							categories={categories}
							handleTitleBlur={handleTitleBlur}
							onTitleChange={onTitleChange}
						/>

						<CurrencyContextSection
							handleExchangeRateChange={handleExchangeRateChange}
							homeCurrency={homeCurrency}
							isCustomRateSet={isCustomRateSet}
							setIsCustomRateSet={setIsCustomRateSet}
							setShowCustomRateDialog={setShowCustomRateDialog}
						/>

						<AmortizationSection />

						{/* Action Bar */}
						<div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
							<div className="order-2 flex items-center gap-2 sm:order-1">
								{expense && (
									<>
										<Button
											className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
											disabled={isDeleting}
											onClick={() => setShowDeleteDialog(true)}
											size="icon"
											type="button"
											variant="ghost"
										>
											<Trash2 className="h-4 w-4" />
											<span className="sr-only">Delete expense</span>
										</Button>
										<Button
											className="gap-1.5"
											disabled={!hasUnsavedChanges}
											onClick={handleUndoChanges}
											size="sm"
											type="button"
											variant="ghost"
										>
											<Undo2 className="h-4 w-4" />
											Undo Changes
										</Button>
									</>
								)}
							</div>

							<div className="order-1 flex flex-col gap-2 sm:order-2 sm:flex-row sm:items-center sm:gap-3">
								<Button
									className="w-full sm:w-auto"
									onClick={() => {
										if (hasUnsavedChanges) {
											setShowUnsavedDialog(true);
										} else {
											onClose?.();
										}
									}}
									type="button"
									variant="ghost"
								>
									Cancel
								</Button>
								<Button
									className="w-full font-semibold sm:w-auto"
									disabled={isSubmitting}
									type="submit"
								>
									{isSubmitting
										? "Saving..."
										: expense
											? "Save Changes"
											: "Create Expense"}
								</Button>
							</div>
						</div>
					</form>
				</Form>

				{/* Dialogs */}
				<Dialog onOpenChange={setShowUnsavedDialog} open={showUnsavedDialog}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Unsaved Changes</DialogTitle>
							<DialogDescription>
								You have unsaved changes. Are you sure you want to leave? All
								changes will be lost.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter className="flex-col gap-2 sm:flex-row">
							<Button
								onClick={() => setShowUnsavedDialog(false)}
								variant="ghost"
							>
								Stay on Page
							</Button>
							<Button onClick={handleDiscardChanges} variant="destructive">
								Discard Changes
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Delete Expense</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete this expense? This action cannot
								be undone.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter className="flex-col gap-2 sm:flex-row">
							<Button
								onClick={() => setShowDeleteDialog(false)}
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={isDeleting}
								onClick={handleDelete}
								variant="destructive"
							>
								{isDeleting ? "Deleting..." : "Delete Expense"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog
					onOpenChange={setShowCustomRateDialog}
					open={showCustomRateDialog}
				>
					<DialogContent className="sm:max-w-md">
						<DialogHeader>
							<DialogTitle>Set Custom Exchange Rate</DialogTitle>
							<DialogDescription>
								Enter the exchange rate for this specific expense.
							</DialogDescription>
						</DialogHeader>
						<div className="py-4">
							<RateSelector
								currency={form.watch("currency")}
								displayMode="foreign-to-default"
								homeCurrency={homeCurrency}
								isCustomSet={isCustomRateSet}
								onCustomCleared={() => setIsCustomRateSet(false)}
								onCustomClick={() => {}}
								onCustomSet={() => setIsCustomRateSet(true)}
								onValueChange={(value: number | undefined) => {
									form.setValue("exchangeRate", value, { shouldDirty: true });
								}}
								value={form.watch("exchangeRate")}
								variant="inline"
							/>
						</div>
						<DialogFooter>
							<Button onClick={() => setShowCustomRateDialog(false)}>
								Done
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</>
		);
	},
);

ExpenseForm.displayName = "ExpenseForm";
