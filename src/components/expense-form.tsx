"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CategoryPicker } from "~/components/category-picker";
import { CurrencyPicker } from "~/components/currency-picker";
import { InlineExchangeRateSelector } from "~/components/inline-exchange-rate-selector";
import { Button } from "~/components/ui/button";
import { DatePicker } from "~/components/ui/date-picker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { CURRENCIES } from "~/lib/currencies";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

// Form validation schema
const expenseSchema = z.object({
	title: z.string().optional(),
	amount: z.number().positive("Amount must be positive"),
	currency: z
		.string()
		.refine((val) => val in CURRENCIES, "Please select a valid currency"),
	exchangeRate: z
		.number()
		.positive("Exchange rate must be positive")
		.optional(),
	amountInUSD: z.number().positive("Amount in USD must be positive").optional(),
	pricingSource: z.string().optional(),
	date: z.date(),
	location: z.string().optional(),
	description: z.string().optional(),
	categoryId: z.string().min(1, "Please select a category"),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;

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
		const router = useRouter();
		const hasUnsavedChangesRef = useRef(false);
		const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
		const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
		const [showDeleteDialog, setShowDeleteDialog] = useState(false);
		const [showCustomRateDialog, setShowCustomRateDialog] = useState(false);
		const [pendingNavigation, setPendingNavigation] = useState<string | null>(
			null,
		);

		useImperativeHandle(
			ref,
			() => ({
				hasUnsavedChanges: () => hasUnsavedChangesRef.current,
				triggerUnsavedDialog: () => {
					setPendingNavigation("close");
					setShowUnsavedDialog(true);
				},
			}),
			[],
		);
		const [isCustomRateSet, setIsCustomRateSet] = useState(false);

		const { data: expense, isLoading: isLoadingExpense } =
			api.expense.getExpense.useQuery(
				{ id: expenseId },
				{ enabled: Boolean(expenseId) },
			);

		const utils = api.useUtils();
		const { data: settings } = api.user.getSettings.useQuery();
		const { getCurrencySymbol } = useCurrencyFormatter();
		const createExpenseMutation = api.expense.createExpense.useMutation({
			onSuccess: () => {
				utils.expense.listFinalized.invalidate();
				utils.dashboard.getOverviewStats.invalidate();
				utils.budget.getBudgets.invalidate();
				utils.expense.getCategorySpending.invalidate();
				utils.expense.getTotalSpending.invalidate();
			},
		});
		const deleteExpenseMutation = api.expense.deleteExpense.useMutation({
			onSuccess: () => {
				utils.expense.listFinalized.invalidate();
				utils.expense.getExpense.invalidate({ id: expenseId });
				utils.dashboard.getOverviewStats.invalidate();
				utils.budget.getBudgets.invalidate();
				utils.expense.getCategorySpending.invalidate();
				utils.expense.getTotalSpending.invalidate();
			},
		});
		const updateExpenseMutation = api.expense.updateExpense.useMutation({
			onSuccess: () => {
				utils.expense.listFinalized.invalidate();
				utils.expense.getExpense.invalidate({ id: expenseId });
				utils.dashboard.getOverviewStats.invalidate();
				utils.budget.getBudgets.invalidate();
				utils.expense.getCategorySpending.invalidate();
				utils.expense.getTotalSpending.invalidate();
			},
		});

		const defaultExpenseCurrency =
			settings?.defaultCurrency ?? settings?.homeCurrency ?? "USD";

		const {
			register,
			handleSubmit,
			watch,
			setValue,
			reset,
			getValues,
			formState: { errors, isDirty },
		} = useForm<ExpenseFormData>({
			resolver: zodResolver(expenseSchema),
			defaultValues: {
				title: "",
				amount: 0,
				currency: defaultExpenseCurrency,
				exchangeRate: undefined,
				amountInUSD: undefined,
				date: new Date(),
				location: "",
				description: "",
				categoryId: "",
			},
		});

		const watchedCurrency = watch("currency");
		const watchedAmount = watch("amount");
		const watchedExchangeRate = watch("exchangeRate");

		// Track unsaved changes
		useEffect(() => {
			hasUnsavedChangesRef.current = isDirty;
			setHasUnsavedChanges(isDirty);
		}, [isDirty]);

		// Recalculate amount when exchange rate changes or amount changes
		const homeCurrency = settings?.homeCurrency || "USD";
		useEffect(() => {
			// Only calculate if currency is NOT the home currency (Anchor)
			if (watchedCurrency !== homeCurrency) {
				if (!watchedAmount) {
					// When foreign amount is empty or 0, home currency amount should also be 0
					setValue("amountInUSD", 0);
				} else if (
					watchedAmount > 0 &&
					watchedExchangeRate &&
					watchedExchangeRate > 0
				) {
					// amountInUSD = amount / exchangeRate (Foreign/Home)
					const calculatedAmount = watchedAmount / watchedExchangeRate;

					// Round to 2 decimal places for home currency
					const decimalPlaces = 2;
					const roundedAmount =
						Math.round(calculatedAmount * 10 ** decimalPlaces) /
						10 ** decimalPlaces;

					setValue("amountInUSD", roundedAmount);
				}
			} else {
				// If currency is home currency, ensure amountInUSD is same as amount
				setValue("amountInUSD", watchedAmount);
			}
		}, [
			watchedAmount,
			watchedExchangeRate,
			watchedCurrency,
			setValue,
			homeCurrency,
		]);

		// Load existing expense data
		useEffect(() => {
			if (expense) {
				const expenseDate = new Date(expense.date);

				reset({
					title: expense.title || "",
					amount: Number(expense.amount),
					currency: expense.currency,
					exchangeRate: expense.exchangeRate
						? Number(expense.exchangeRate)
						: undefined,
					amountInUSD: expense.amountInUSD
						? Number(expense.amountInUSD)
						: undefined,
					date: expenseDate,
					location: expense.location || "",
					description: expense.description || "",
					categoryId: expense.categoryId || "",
				});

				// Update window title
				if (onTitleChange) {
					onTitleChange(expense.title || "");
				}
			} else if (!isLoadingExpense) {
				// New expense - set defaults
				const defaultDate = new Date();

				reset({
					title: "",
					amount: 0,
					currency: defaultExpenseCurrency,
					exchangeRate: undefined,
					amountInUSD: undefined,
					date: defaultDate,
					location: "",
					description: "",
					categoryId: "",
				});

				// Update window title
				if (onTitleChange) {
					onTitleChange("");
				}
			}
		}, [
			expense,
			isLoadingExpense,
			reset,
			onTitleChange,
			defaultExpenseCurrency,
		]);

		useEffect(() => {
			if (isModal) return;

			const handleBeforeUnload = (e: BeforeUnloadEvent) => {
				if (hasUnsavedChanges) {
					e.preventDefault();
					e.returnValue = "";
				}
			};

			const handleAnchorClick = (event: MouseEvent) => {
				if (!hasUnsavedChanges) return;
				const target = event.target as HTMLElement | null;
				const anchor = target?.closest<HTMLAnchorElement>("a[href]");
				if (!anchor) return;

				const href = anchor.getAttribute("href");
				if (
					!href ||
					href.startsWith("#") ||
					href.startsWith("mailto:") ||
					href.startsWith("tel:")
				) {
					return;
				}

				if (anchor.target === "_blank") return;

				const url = new URL(href, window.location.href);
				if (url.href === window.location.href) return;

				event.preventDefault();
				setPendingNavigation(url.pathname + url.search + url.hash);
				setShowUnsavedDialog(true);
			};

			const handlePopState = (event: PopStateEvent) => {
				if (!hasUnsavedChanges) return;
				event.preventDefault();
				history.pushState(null, "", window.location.href);
				setPendingNavigation("back");
				setShowUnsavedDialog(true);
			};

			window.addEventListener("beforeunload", handleBeforeUnload);
			window.addEventListener("click", handleAnchorClick);
			window.addEventListener("popstate", handlePopState);

			return () => {
				window.removeEventListener("beforeunload", handleBeforeUnload);
				window.removeEventListener("click", handleAnchorClick);
				window.removeEventListener("popstate", handlePopState);
			};
		}, [hasUnsavedChanges, isModal]);

		const onSubmit = async (
			data: ExpenseFormData,
			_finalize: boolean = false,
		) => {
			try {
				const submitData = {
					...data,
					title: data.title || "",
					exchangeRate: data.exchangeRate || undefined,
					amountInUSD: data.amountInUSD || undefined,
					description: data.description || undefined,
				};

				if (expense) {
					// EDIT MODE: Always use updateExpense mutation
					await updateExpenseMutation.mutateAsync({
						id: expenseId,
						...submitData,
					});
					toast.success("Changes saved!");
					reset(getValues());
					hasUnsavedChangesRef.current = false;
					setHasUnsavedChanges(false);
					if (isModal) {
						onClose?.();
					} else {
						router.push("/app");
					}
				} else {
					await createExpenseMutation.mutateAsync({
						id: expenseId,
						...submitData,
					});

					toast.success("Expense saved successfully!");
					reset(getValues());
					hasUnsavedChangesRef.current = false;
					setHasUnsavedChanges(false);
					if (isModal) {
						onClose?.();
					} else {
						router.push("/app");
					}
				}
			} catch (_error) {
				toast.error("Failed to save expense");
			}
		};

		const handleDelete = async () => {
			try {
				await deleteExpenseMutation.mutateAsync({ id: expenseId });
				toast.success("Expense deleted successfully!");
				router.push("/app");
			} catch (_error) {
				toast.error("Failed to delete expense");
			}
		};

		const handleUndoChanges = () => {
			if (expense) {
				const expenseDate = new Date(expense.date);
				reset({
					title: expense.title || "",
					amount: Number(expense.amount),
					currency: expense.currency,
					exchangeRate: expense.exchangeRate
						? Number(expense.exchangeRate)
						: undefined,
					amountInUSD: expense.amountInUSD
						? Number(expense.amountInUSD)
						: undefined,
					date: expenseDate,
					location: expense.location || "",
					description: expense.description || "",
					categoryId: expense.categoryId || "",
				});
				hasUnsavedChangesRef.current = false;
				setHasUnsavedChanges(false);
				toast.info("Changes reverted");
			}
		};

		const handleSave = handleSubmit((data: ExpenseFormData) =>
			onSubmit(data, true),
		);

		const handleDiscardChanges = () => {
			setShowUnsavedDialog(false);
			hasUnsavedChangesRef.current = false;
			setHasUnsavedChanges(false);
			if (pendingNavigation) {
				if (pendingNavigation === "back") {
					router.back();
				} else if (pendingNavigation === "close") {
					onClose?.();
				} else {
					router.push(pendingNavigation);
				}
			}
		};

		if (isLoadingExpense) {
			return <div className="p-4">Loading...</div>;
		}

		return (
			<>
				<form className="space-y-4 sm:space-y-6">
					{/* Hero Row: Amount and Currency */}
					<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
						<div className="flex-1 space-y-2">
							<Label htmlFor="amount">Amount</Label>
							<div
								className={cn(
									"flex h-auto min-h-[2.25rem] w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
									"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
									errors.amount &&
										"border-destructive focus-within:ring-destructive/20 dark:focus-within:ring-destructive/40",
								)}
							>
								<span className="shrink-0 font-medium text-muted-foreground">
									{getCurrencySymbol(watchedCurrency)}
								</span>
								<Input
									id="amount"
									step="0.01"
									type="number"
									{...register("amount", {
										valueAsNumber: true,
										onChange: (e) => {
											const value = e.target.value
												? parseFloat(e.target.value)
												: 0;

											// Trigger recalculation of amountInUSD
											if (
												watchedCurrency !== (settings?.homeCurrency || "USD") &&
												watchedExchangeRate &&
												watchedExchangeRate > 0
											) {
												// amountInUSD = amount / rate
												const calculatedAmount = value / watchedExchangeRate;

												const decimalPlaces = 2;
												const roundedAmount =
													Math.round(calculatedAmount * 10 ** decimalPlaces) /
													10 ** decimalPlaces;

												setValue("amountInUSD", value ? roundedAmount : 0);
											} else if (
												watchedCurrency !== (settings?.homeCurrency || "USD")
											) {
												// No exchange rate yet, set to 0
												setValue("amountInUSD", 0);
											}
										},
									})}
									className="h-full w-full grow border-0 bg-transparent px-0 py-0 font-bold text-lg shadow-none focus-visible:ring-0 sm:text-2xl dark:bg-transparent"
									placeholder="0.00"
								/>
							</div>
							{errors.amount && (
								<p className="text-red-500 text-sm">{errors.amount.message}</p>
							)}
						</div>

						<div className="w-full space-y-2 sm:w-72">
							<Label htmlFor="currency">Currency</Label>
							<CurrencyPicker
								onValueChange={(value) => {
									setValue("currency", value);
									// Clear the exchange rate when currency changes so new rates can be loaded
									setValue("exchangeRate", undefined);
									// Reset amount in USD until new rate is available
									setValue("amountInUSD", 0);
								}}
								placeholder="Select currency"
								value={watch("currency")}
							/>
							{errors.currency && (
								<p className="text-red-500 text-sm">
									{errors.currency.message}
								</p>
							)}
						</div>
					</div>

					{/* Context Row: Title and Category */}
					<div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
						<div className="flex-1 space-y-2">
							<Label htmlFor="title">Expense Title</Label>
							<Input
								id="title"
								{...register("title", {
									onChange: (e) => {
										const value = e.target.value;
										onTitleChange?.(value);
									},
								})}
								placeholder="Enter expense title"
							/>
							{errors.title && (
								<p className="text-red-500 text-sm">{errors.title.message}</p>
							)}
						</div>

						<div className="w-full space-y-2 sm:w-64">
							<Label>Category</Label>
							<CategoryPicker
								onValueChange={(value) => setValue("categoryId", value)}
								placeholder="Select a category"
								value={watch("categoryId")}
							/>
							{errors.categoryId && (
								<p className="text-red-500 text-sm">
									{errors.categoryId.message}
								</p>
							)}
						</div>
					</div>

					{/* Math Row: Date, Exchange Rate, AmountInUSD */}
					{watchedCurrency !== (settings?.homeCurrency || "USD") ? (
						<div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
							<div className="space-y-2">
								<Label>Date</Label>
								<DatePicker
									date={watch("date")}
									onSelect={(date) => date && setValue("date", date)}
									placeholder="Select date"
								/>
								{errors.date && (
									<p className="text-red-500 text-sm">{errors.date.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="amountInUSD">
									Amount in {settings?.homeCurrency || "USD"}
								</Label>
								<div
									className={cn(
										"flex h-9 w-full items-center gap-2 rounded-md border border-input bg-muted px-3 py-1 shadow-xs",
										errors.amountInUSD && "border-destructive",
									)}
								>
									<span className="shrink-0 font-medium text-muted-foreground">
										{getCurrencySymbol(settings?.homeCurrency || "USD")}
									</span>
									<Input
										disabled={true}
										id="amountInUSD"
										readOnly={true}
										step="0.01"
										type="number"
										{...register("amountInUSD", {
											valueAsNumber: true,
										})}
										className="h-full w-full grow cursor-default select-none border-0 bg-transparent px-0 py-0 text-muted-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
										placeholder="0.00"
									/>
								</div>
								{errors.amountInUSD && (
									<p className="text-red-500 text-sm">
										{errors.amountInUSD.message}
									</p>
								)}
							</div>

							<div className="space-y-2">
								<Label>Exchange Rate</Label>
								<div className="flex gap-2">
									<InlineExchangeRateSelector
										currency={watchedCurrency}
										homeCurrency={settings?.homeCurrency || "USD"}
										isCustomSet={isCustomRateSet} // Force 1 USD = X Foreign
										mode={true}
										onCustomCleared={() => setIsCustomRateSet(false)}
										onCustomSelected={() => setShowCustomRateDialog(true)}
										onCustomSet={() => setIsCustomRateSet(true)}
										onValueChange={(value) => {
											setValue("exchangeRate", value);
										}}
										value={watchedExchangeRate}
									/>
									{isCustomRateSet && (
										<Button
											className="h-9 px-3"
											onClick={() => setShowCustomRateDialog(true)}
											type="button"
											variant="outline"
										>
											Edit
										</Button>
									)}
								</div>
							</div>
						</div>
					) : (
						<div className="grid grid-cols-1 gap-3 sm:gap-4">
							<div className="space-y-2">
								<Label>Date</Label>
								<DatePicker
									date={watch("date")}
									onSelect={(date) => date && setValue("date", date)}
									placeholder="Select date"
								/>
								{errors.date && (
									<p className="text-red-500 text-sm">{errors.date.message}</p>
								)}
							</div>
						</div>
					)}

					<div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="description">Description (Optional)</Label>
							<Input
								id="description"
								{...register("description")}
								placeholder="Additional details about the expense"
							/>
							{errors.description && (
								<p className="text-red-500 text-sm">
									{errors.description.message}
								</p>
							)}
						</div>

						<div className="space-y-2">
							<Label htmlFor="location">Location (Optional)</Label>
							<Input
								id="location"
								{...register("location")}
								placeholder="Where was the expense made?"
							/>
							{errors.location && (
								<p className="text-red-500 text-sm">
									{errors.location.message}
								</p>
							)}
						</div>
					</div>

					{/* Mobile-first action bar */}
					<div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
						{/* LEFT SIDE - Only visible in EDIT mode */}
						<div className="order-2 flex items-center gap-2 sm:order-1">
							{expense ? (
								<>
									{/* Delete button - icon only */}
									<Button
										className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
										disabled={deleteExpenseMutation.isPending}
										onClick={() => setShowDeleteDialog(true)}
										size="icon"
										type="button"
										variant="ghost"
									>
										<Trash2 className="h-4 w-4" />
										<span className="sr-only">Delete expense</span>
									</Button>
									{/* Undo Changes button - always visible, disabled when no changes */}
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
							) : null}
						</div>

						{/* RIGHT SIDE - Different buttons for ADD vs EDIT mode */}
						<div className="order-1 flex flex-col gap-2 sm:order-2 sm:flex-row sm:items-center sm:gap-3">
							{/* Cancel button - always shown */}
							<Button
								className="w-full sm:w-auto"
								onClick={() => {
									if (hasUnsavedChanges) {
										if (isModal) {
											setPendingNavigation("close");
										} else {
											setPendingNavigation("/");
										}
										setShowUnsavedDialog(true);
										return;
									}
									if (isModal) {
										onClose?.();
									} else {
										router.push("/app");
									}
								}}
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>

							{/* ADD MODE: Save Expense */}
							{!expense && (
								<Button
									className="w-full sm:w-auto"
									disabled={createExpenseMutation.isPending}
									onClick={handleSave}
									type="button"
								>
									{createExpenseMutation.isPending
										? "Saving..."
										: "Save Expense"}
								</Button>
							)}

							{/* EDIT MODE: Save Changes only */}
							{expense && (
								<Button
									className="w-full sm:w-auto"
									disabled={updateExpenseMutation.isPending}
									onClick={handleSave}
									type="button"
								>
									{updateExpenseMutation.isPending
										? "Saving..."
										: "Save Changes"}
								</Button>
							)}
						</div>
					</div>
				</form>

				<Dialog onOpenChange={setShowUnsavedDialog} open={showUnsavedDialog}>
					<DialogContent className="w-full max-w-full sm:max-w-md">
						<DialogHeader>
							<DialogTitle>Unsaved Changes</DialogTitle>
							<DialogDescription>
								You have unsaved changes. Are you sure you want to leave without
								saving?
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								onClick={() => setShowUnsavedDialog(false)}
								variant="outline"
							>
								Stay
							</Button>
							<Button onClick={handleDiscardChanges} variant="destructive">
								Discard Changes
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
					<DialogContent className="w-full max-w-full sm:max-w-md">
						<DialogHeader>
							<DialogTitle>Delete Expense</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete this expense? This action cannot
								be undone.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								onClick={() => setShowDeleteDialog(false)}
								variant="outline"
							>
								Cancel
							</Button>
							<Button onClick={handleDelete} variant="destructive">
								Delete
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				{/* Custom Rate Dialog */}
				<Dialog
					modal={true}
					onOpenChange={setShowCustomRateDialog}
					open={showCustomRateDialog}
				>
					<DialogContent className="w-full max-w-full sm:max-w-md">
						<DialogHeader>
							<DialogTitle>Custom Exchange Rate</DialogTitle>
							<DialogDescription>
								Enter a custom exchange rate for {watchedCurrency} to{" "}
								{homeCurrency}
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-3 sm:space-y-4">
							<div className="space-y-2">
								<Label htmlFor="custom-rate">
									Exchange Rate (Foreign per {homeCurrency})
								</Label>
								<Input
									id="custom-rate"
									onChange={(e) => {
										const value = e.target.value
											? parseFloat(e.target.value)
											: undefined;
										setValue("exchangeRate", value);

										// Use the current amount in USD from the modal to calculate foreign amount
										const currentDefaultAmount = watch("amountInUSD");
										if (!currentDefaultAmount || currentDefaultAmount === 0) {
											setValue("amount", 0);
										} else if (value && value > 0 && currentDefaultAmount > 0) {
											// amount = amountInUSD * rate
											const calculatedForeignAmount =
												currentDefaultAmount * value;

											const decimalPlaces =
												CURRENCIES[watchedCurrency]?.decimal_digits ?? 2;
											const roundedForeignAmount =
												Math.round(
													calculatedForeignAmount * 10 ** decimalPlaces,
												) /
												10 ** decimalPlaces;
											setValue("amount", roundedForeignAmount);
										}
									}}
									placeholder="e.g., 1470"
									step="0.000001"
									type="number"
									value={watchedExchangeRate || ""}
								/>
								<p className="text-muted-foreground text-xs">
									1 {homeCurrency} ={" "}
									{watchedExchangeRate
										? watchedExchangeRate.toLocaleString()
										: "X"}{" "}
									{watchedCurrency}
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="custom-amount-default">
									Amount in {homeCurrency}
								</Label>
								<div
									className={cn(
										"flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
										"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
										errors.amountInUSD &&
											"border-destructive focus-within:ring-destructive/20 dark:focus-within:ring-destructive/40",
									)}
								>
									<span className="shrink-0 font-medium text-muted-foreground">
										{getCurrencySymbol(homeCurrency)}
									</span>
									<Input
										id="custom-amount-default"
										step="0.01"
										type="number"
										{...register("amountInUSD", {
											valueAsNumber: true,
											onChange: (e) => {
												const value = e.target.value
													? parseFloat(e.target.value)
													: null;

												const currentForeignAmount = watch("amount");

												// Rate = Foreign / USD
												if (
													value &&
													value > 0 &&
													currentForeignAmount &&
													currentForeignAmount > 0
												) {
													const newRate = currentForeignAmount / value;
													setValue("exchangeRate", newRate);
												}
												// Fallback: Use existing rate
												else if (
													value &&
													value > 0 &&
													watchedExchangeRate &&
													watchedExchangeRate > 0
												) {
													// amount = amountInUSD * rate
													const calculatedForeignAmount =
														value * watchedExchangeRate;

													const decimalPlaces =
														CURRENCIES[watchedCurrency]?.decimal_digits ?? 2;
													const roundedForeignAmount =
														Math.round(
															calculatedForeignAmount * 10 ** decimalPlaces,
														) /
														10 ** decimalPlaces;

													setValue("amount", roundedForeignAmount);
												}
											},
										})}
										className="h-full w-full grow border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
										placeholder="0.00"
									/>
								</div>
								{errors.amountInUSD && (
									<p className="text-red-500 text-sm">
										{errors.amountInUSD.message}
									</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="custom-amount-foreign">
									Amount in {watchedCurrency}
								</Label>
								<div
									className={cn(
										"flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
										"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
										errors.amount &&
											"border-destructive focus-within:ring-destructive/20 dark:focus-within:ring-destructive/40",
									)}
								>
									<span className="shrink-0 font-medium text-muted-foreground">
										{getCurrencySymbol(watchedCurrency)}
									</span>
									<Input
										id="custom-amount-foreign"
										step="0.01"
										type="number"
										{...register("amount", {
											valueAsNumber: true,
											onChange: (e) => {
												const value = e.target.value
													? parseFloat(e.target.value)
													: null;

												const currentDefaultAmount = watch("amountInUSD");

												// Rate = Foreign / USD
												if (
													value &&
													value > 0 &&
													currentDefaultAmount &&
													currentDefaultAmount > 0
												) {
													const newRate = value / currentDefaultAmount;
													setValue("exchangeRate", newRate);
												}
												// Fallback
												else if (
													value &&
													value > 0 &&
													watchedExchangeRate &&
													watchedExchangeRate > 0
												) {
													// amountInUSD = amount / rate
													const calculatedDefaultAmount =
														value / watchedExchangeRate;

													const decimalPlaces = 2;
													const roundedDefaultAmount =
														Math.round(
															calculatedDefaultAmount * 10 ** decimalPlaces,
														) /
														10 ** decimalPlaces;

													setValue("amountInUSD", roundedDefaultAmount);
												}
											},
										})}
										className="h-full w-full grow border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
										placeholder="0.00"
									/>
								</div>
								{errors.amount && (
									<p className="text-red-500 text-sm">
										{errors.amount.message}
									</p>
								)}
							</div>
						</div>
						<DialogFooter>
							<Button
								onClick={() => setShowCustomRateDialog(false)}
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								onClick={() => {
									setIsCustomRateSet(true);
									setShowCustomRateDialog(false);
								}}
							>
								Use Custom Rate
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</>
		);
	},
);
ExpenseForm.displayName = "ExpenseForm";
