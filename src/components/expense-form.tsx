"use client";

import { AlertTriangle, Info, ListPlus, Trash2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, useImperativeHandle, useState } from "react";
import { ProjectVisual } from "~/components/project/project-visual";
import { SplitWithPicker } from "~/components/split-with-picker";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { useExpenseForm, type ExpenseInitialValues } from "~/hooks/use-expense-form";
import { Switch } from "~/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { CurrencyAmountInput } from "./expense/form-sections/CurrencyAmountInput";
import { DetailsSection } from "./expense/form-sections/DetailsSection";
import { FrequencySection } from "./expense/form-sections/FrequencySection";
import { SharedExpenseSection } from "./expense/form-sections/SharedExpenseSection";

interface ExpenseFormProps {
	expenseId: string;
	sharedTransactionId?: string;
	mode?: "create" | "edit";
	onTitleChange?: (title: string) => void;
	isModal?: boolean;
	onClose?: () => void;
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

export interface ExpenseFormHandle {
	hasUnsavedChanges: () => boolean;
	triggerUnsavedDialog: () => void;
}

export const ExpenseForm = forwardRef<ExpenseFormHandle, ExpenseFormProps>(
	(
		{
			expenseId,
			sharedTransactionId,
			mode = "edit",
			onTitleChange,
			isModal = false,
			onClose,
			onSaveAndNew,
			projectId,
			projectDefaultCurrency,
			isSolo,
			initialValues,
			stickyDefaults,
			currentParticipant,
		},
		ref,
	) => {
		const {
			form,
			onSubmit,
			handleAmountChange,
			handleCurrencyChange,
			handleExchangeRateChange,
			handleTitleChange,
		handleCategoryChange,
			handleExcludeToggle,
			excludeAutoNote,
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
			setPendingNavigation,
			isCustomRateSet,
			setIsCustomRateSet,
			categories,
			homeCurrency,
			expense,
			// Save & Add Another
			saveAndNewRef,
			// Duplicate detection
			duplicateWarning,
			// Title suggestions
			categoryAutoSuggested,
			amountHint,
			// Shared expense
			splitWith,
			setSplitWith,
			splitMode,
			handleSplitModeChange,
			paidBy,
			setPaidBy,
			exactAmounts,
			handleExactAmountChange,
			percentages,
			handlePercentageChange,
			shares,
			handleSharesChange,
			theyOweFullAmount,
			setTheyOweFullAmount,
			isSharedExpense,
			currentUser,
			isSharedTransactionEdit,
			hasVerifiedParticipants,
			sharedTxProjectId,
			// Project selector
			selectedProjectId,
			handleProjectChange,
			selectableProjects,
			isSelectedSoloProject,
		} = useExpenseForm({
			expenseId,
			sharedTransactionId,
			mode,
			isModal,
			onClose,
			onSaveAndNew,
			onTitleChange,
			projectId,
			projectDefaultCurrency,
			isSolo,
			initialValues,
			stickyDefaults,
			currentParticipant,
		});

		const t = useTranslations("expenseForm");

		const [showDeleteDialog, setShowDeleteDialog] = useState(false);
		const [projectChangeWarning, setProjectChangeWarning] = useState<{
			show: boolean;
			targetId: string | null;
		}>({ show: false, targetId: null });

		const handleProjectClick = (newId: string | null) => {
			// Only warn if the user has a non-default split configuration that would be lost
			const hasCustomSplit =
				splitWith.length > 0 && (splitMode !== "EQUAL" || theyOweFullAmount);
			if (hasCustomSplit && newId !== selectedProjectId) {
				setProjectChangeWarning({ show: true, targetId: newId });
				return;
			}
			handleProjectChange(newId);
		};

		const confirmProjectChangeAndApply = () => {
			handleProjectChange(projectChangeWarning.targetId);
			setProjectChangeWarning({ show: false, targetId: null });
		};

		const showProjectSelector =
			selectableProjects.length > 0 &&
			!currentParticipant &&
			(mode === "create" || isSharedTransactionEdit);

		const visiblePillCount =
			selectableProjects.length >= 7 ? 5 : selectableProjects.length;

		useImperativeHandle(
			ref,
			() => ({
				hasUnsavedChanges: () => hasUnsavedChangesRef.current,
				triggerUnsavedDialog: () => {
					setPendingNavigation("close");
					setShowUnsavedDialog(true);
				},
			}),
			[hasUnsavedChangesRef, setShowUnsavedDialog, setPendingNavigation],
		);

		if (isLoading) {
			return (
				<div className="space-y-4 p-4 sm:space-y-6">
					<Skeleton className="h-12 w-full" />
					<div className="space-y-3">
						<Skeleton className="h-9 w-full" />
						<div className="flex gap-4">
							<Skeleton className="h-9 flex-1" />
							<Skeleton className="h-9 w-32" />
						</div>
					</div>
					<Skeleton className="h-9 w-full" />
				</div>
			);
		}

		const actionBar = (
			<div className="flex flex-col gap-3">
				{/* Duplicate warning */}
				{duplicateWarning && (
					<div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 text-sm dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						<span>{t("duplicateWarning")}</span>
					</div>
				)}
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
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
								<span className="sr-only">{t("deleteExpenseSr")}</span>
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
								{t("undoChanges")}
							</Button>
						</>
					)}
				</div>

				<div className="order-1 flex flex-col gap-2 sm:order-2 sm:flex-row sm:items-center sm:gap-3">
					<Button
						className="w-full sm:w-auto"
						onClick={() => {
							if (hasUnsavedChanges) {
								setPendingNavigation("close");
								setShowUnsavedDialog(true);
							} else {
								onClose?.();
							}
						}}
						type="button"
						variant="ghost"
					>
						{t("cancel")}
					</Button>
					{mode === "create" && onSaveAndNew && (
						<Button
							className="w-full gap-1.5 sm:w-auto"
							disabled={isSubmitting}
							onClick={() => {
								saveAndNewRef.current = true;
								form.handleSubmit(onSubmit)();
							}}
							type="button"
							variant="outline"
						>
							<ListPlus className="h-4 w-4" />
							<span className="hidden sm:inline">{t("saveAndAddAnother")}</span>
							<span className="sm:hidden">{t("saveAndNew")}</span>
						</Button>
					)}
					<Button
						className="w-full font-semibold sm:w-auto"
						disabled={isSubmitting}
						type="submit"
					>
						{isSubmitting
							? t("saving")
							: isSharedTransactionEdit
								? t("saveChanges")
								: expense
									? t("saveChanges")
									: isSharedExpense
										? t("createSharedExpense")
										: t("createExpense")}
					</Button>
				</div>
			</div>
			</div>
		);

		return (
			<>
				{/* Verification warning for shared transaction edit */}
				{isSharedTransactionEdit && hasVerifiedParticipants && (
					<div className="mx-4 mt-2 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 sm:mx-6">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<p>
							{t("verificationWarning")}
						</p>
					</div>
				)}

				<Form {...form}>
					<form
						className="flex flex-col"
						onSubmit={form.handleSubmit(onSubmit)}
					>
						{/* Scrollable form body */}
						<div className="space-y-6 px-4 py-4 sm:px-6">
							{/* Amount + Currency */}
							<CurrencyAmountInput
								handleAmountChange={handleAmountChange}
								handleCurrencyChange={handleCurrencyChange}
								handleExchangeRateChange={handleExchangeRateChange}
								homeCurrency={homeCurrency}
								isCustomRateSet={isCustomRateSet}
								setIsCustomRateSet={setIsCustomRateSet}
								amountHint={amountHint}
							/>

							{/* Title / Category / Date */}
							<DetailsSection
								categories={categories}
								handleTitleChange={handleTitleChange}
								handleCategoryChange={handleCategoryChange}
								onTitleChange={onTitleChange}
								categoryAutoSuggested={categoryAutoSuggested}
							/>

							{/* Description + Location */}
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
								<div className="space-y-2">
									<Label htmlFor="description" className="font-normal text-muted-foreground">{t("description")}</Label>
									<Input
										id="description"
										{...form.register("description")}
										placeholder={t("descriptionPlaceholder")}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="location" className="font-normal text-muted-foreground">{t("location")}</Label>
									<Input
										id="location"
										{...form.register("location")}
										placeholder={t("locationPlaceholder")}
									/>
								</div>
							</div>

							{/* Project selector */}
							{showProjectSelector && (
								<div className="space-y-2">
									<Label className="font-normal text-muted-foreground">{t("project")}</Label>
									<div className="flex flex-wrap items-center gap-1.5">
										<Button
											type="button"
											onClick={() => handleProjectClick(null)}
											variant="outline"
											size="sm"
											className={cn(
												"h-auto gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
												!selectedProjectId
													? "border-primary/40 bg-primary/10 dark:bg-primary/10 text-primary"
													: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
											)}
										>
											{t("none")}
										</Button>
										{selectableProjects.slice(0, visiblePillCount).map((project) => {
											const active = selectedProjectId === project.id;
											return (
												<Button
													key={project.id}
													type="button"
													onClick={() => handleProjectClick(project.id)}
													variant="outline"
													size="sm"
													className={cn(
														"h-auto gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
														active
															? "border-primary/40 bg-primary/10 dark:bg-primary/10 text-primary"
															: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
													)}
												>
													<ProjectVisual
														size="xs"
														imagePath={project.imagePath}
														projectName={project.name}
													/>
													<span className="max-w-[120px] truncate">{project.name}</span>
												</Button>
											);
										})}
										{selectableProjects.length > visiblePillCount && (
											<Popover>
												<PopoverTrigger asChild>
													<Button
														type="button"
														variant="outline"
														size="sm"
														className="h-auto gap-1.5 rounded-full px-2.5 py-1 text-muted-foreground text-xs font-medium hover:bg-accent hover:text-accent-foreground"
													>
														{t("more", { count: selectableProjects.length - visiblePillCount })}
													</Button>
												</PopoverTrigger>
												<PopoverContent align="start" className="w-56 p-1">
													<div className="flex flex-col">
														{selectableProjects.slice(visiblePillCount).map((project) => (
															<Button
																key={project.id}
																variant="ghost"
																size="sm"
																className={cn(
																	"justify-start gap-2",
																	selectedProjectId === project.id && "bg-primary/10 text-primary",
																)}
																onClick={() => handleProjectClick(project.id)}
																type="button"
															>
																<ProjectVisual
																	size="xs"
																	imagePath={project.imagePath}
																	projectName={project.name}
																/>
																{project.name}
															</Button>
														))}
													</div>
												</PopoverContent>
											</Popover>
										)}
									</div>
								</div>
							)}

							{/* Share With (hidden for solo projects) */}
							{(mode === "create" || isSharedTransactionEdit) && !isSelectedSoloProject && (
								<div className="space-y-2">
									<Label>{t("shareWith")}</Label>
									<SplitWithPicker
										onChange={setSplitWith}
										value={splitWith}
										projectId={selectedProjectId ?? sharedTxProjectId ?? undefined}
										currentUserId={currentUser.id || undefined}
									/>
								</div>
							)}

							{/* Shared expense fields: revealed when split participants exist */}
							{isSharedExpense && (
								<SharedExpenseSection
									currentUser={currentUser}
									exactAmounts={exactAmounts}
									onExactAmountChange={handleExactAmountChange}
									onPaidByChange={setPaidBy}
									onPercentageChange={handlePercentageChange}
									onSharesChange={handleSharesChange}
									onSplitModeChange={handleSplitModeChange}
									onTheyOweFullAmountChange={setTheyOweFullAmount}
									paidBy={paidBy}
									percentages={percentages}
									shares={shares}
									splitMode={splitMode}
									splitWith={splitWith}
									theyOweFullAmount={theyOweFullAmount}
								/>
							)}

							{/* Frequency (amortization) + Exclude from spending - not available for project expenses */}
							{!selectedProjectId && !sharedTxProjectId && (
								<div className="flex flex-col gap-1">
									<FrequencySection
										rightSlot={
											!isSharedExpense && !isSharedTransactionEdit ? (
												<div className="ml-auto flex shrink-0 items-center gap-1.5">
													<span className="text-muted-foreground text-sm">{t("excludeFromSpending")}</span>
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<Info className="h-3.5 w-3.5 cursor-default text-muted-foreground/50" />
															</TooltipTrigger>
															<TooltipContent className="max-w-xs">
																{t("excludeTooltip")}
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
													<Switch
														checked={form.watch("excludeFromAnalytics") ?? false}
														onCheckedChange={handleExcludeToggle}
													/>
												</div>
											) : undefined
										}
									/>
									{!isSharedExpense && !isSharedTransactionEdit && excludeAutoNote && (
										<span className="pl-[calc(5rem+0.75rem)] text-muted-foreground/60 text-xs">{t("autoExcluded")}</span>
									)}
								</div>
							)}
						</div>

						{/* Sticky footer */}
						<div className="shrink-0 border-t px-4 py-4 sm:px-6">
							{actionBar}
						</div>
					</form>
				</Form>

				{/* Dialogs */}
				<Dialog onOpenChange={setShowUnsavedDialog} open={showUnsavedDialog}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("unsavedChanges")}</DialogTitle>
							<DialogDescription>
								{t("unsavedDescription")}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter className="flex-col gap-2 sm:flex-row">
							<Button
								onClick={() => setShowUnsavedDialog(false)}
								variant="ghost"
							>
								{t("stayOnPage")}
							</Button>
							<Button onClick={handleDiscardChanges} variant="destructive">
								{t("discardChanges")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("deleteExpense")}</DialogTitle>
							<DialogDescription>
								{t("deleteDescription")}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter className="flex-col gap-2 sm:flex-row">
							<Button
								onClick={() => setShowDeleteDialog(false)}
								variant="ghost"
							>
								{t("cancel")}
							</Button>
							<Button
								disabled={isDeleting}
								onClick={handleDelete}
								variant="destructive"
							>
								{isDeleting ? t("deleting") : t("deleteExpense")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog
					onOpenChange={(open) => {
						if (!open) setProjectChangeWarning({ show: false, targetId: null });
					}}
					open={projectChangeWarning.show}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("changeProject")}</DialogTitle>
							<DialogDescription>
								{t("changeProjectDescription")}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter className="flex-col gap-2 sm:flex-row">
							<Button
								onClick={() => setProjectChangeWarning({ show: false, targetId: null })}
								variant="ghost"
							>
								{t("cancel")}
							</Button>
							<Button onClick={confirmProjectChangeAndApply}>
								{t("changeProjectConfirm")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				</>
		);
	},
);

ExpenseForm.displayName = "ExpenseForm";
