"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CurrencyPicker } from "~/components/currency-picker";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
	ResponsiveDialogTrigger,
} from "~/components/ui/responsive-dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { RateSelector } from "~/components/ui/rate-selector";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { useCurrencyConversion } from "~/hooks/use-currency-conversion";
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import type { CurrencyCode } from "~/lib/currencies";
import {
	formatNumber,
	isCrypto as checkIsCrypto,
	isMajorCrypto,
} from "~/lib/currency-format";
import { useCurrencyInput } from "~/hooks/use-currency-input";
import { AssetType } from "~/lib/db-enums";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const formSchema = z.object({
	name: z.string().min(1, "Name is required"),
	type: z.nativeEnum(AssetType),
	currency: z.string().length(3, "Currency must be 3 characters"),
	balance: z.coerce.number().min(0, "Balance must be positive"),
	exchangeRate: z.coerce.number().optional(),
	exchangeRateType: z.string().optional(),
	isLiquid: z.boolean(),
	interestRate: z.coerce.number().min(0).optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface AssetDialogProps {
	assetId?: string; // Presence implies edit mode
	initialValues?: Partial<FormValues>;
	trigger?: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

const createDefaults: FormValues = {
	name: "",
	type: AssetType.CASH,
	currency: "USD",
	balance: 0,
	isLiquid: true,
};

export function AssetDialog({
	assetId,
	initialValues,
	trigger,
	open: controlledOpen,
	onOpenChange: setControlledOpen,
}: AssetDialogProps) {
	const isEdit = !!assetId;
	const title = isEdit ? "Edit Asset" : "Add Asset";
	const description = isEdit
		? "Update your asset details."
		: "Create a new asset to track your wealth.";
	const submitLabel = isEdit ? "Update Asset" : "Create Asset";
	const loadingLabel = isEdit ? "Updating..." : "Creating...";

	const [internalOpen, setInternalOpen] = useState(false);

	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;
	const setOpen = isControlled ? setControlledOpen : setInternalOpen;

	const { toUSD } = useCurrencyConversion();
	const utils = api.useUtils();

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: isEdit
			? { ...createDefaults, ...initialValues }
			: createDefaults,
	});

	// Initial rate fix (one-time logic for corrupt data)
	const [exchangeRate, setExchangeRate] = useState<number | undefined>(() => {
		const initRate = initialValues?.exchangeRate;
		const initCurr = initialValues?.currency;

		if (initRate && initCurr && initCurr !== "USD") {
			const isActuallyCrypto = checkIsCrypto(initCurr);
			// Known big cryptos fix: BTC/SOL/etc should be > 1
			if (isActuallyCrypto) {
				if (isMajorCrypto(initCurr) && initRate > 0 && initRate < 1) {
					return 1 / initRate;
				}
			}
			return initRate;
		}
		return initRate;
	});

	const [exchangeRateType, setExchangeRateType] = useState<string | undefined>(
		initialValues?.exchangeRateType,
	);
	const [isCustomRate, setIsCustomRate] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	// Get form values for hooks and effects
	const watchedBalance = form.watch("balance");
	const watchedCurrency = form.watch("currency");

	const balanceInput = useCurrencyInput({
		value: watchedBalance,
		onChange: (n) => form.setValue("balance", n, { shouldDirty: true }),
		currency: watchedCurrency,
	});

	const interestRateInput = useCurrencyInput({
		value: form.watch("interestRate") ?? 0,
		onChange: (n) => form.setValue("interestRate", n || undefined, { shouldDirty: true }),
		decimals: 2,
	});

	const handleExchangeRateChange = useCallback(
		(rate: number | undefined, type?: string) => {
			setExchangeRate(rate);
			setExchangeRateType(type);
		},
		[],
	);

	// Fetch rates to validate and auto-correct potential inversion bugs
	const { rateOptions } = useExchangeRates({
		currency: watchedCurrency,
		enabled: open && watchedCurrency !== "USD",
	});

	// Fiat: State and Picker now both use "System" rate (Units per USD) to avoid precision loss.
	// Crypto: State and Picker both use "Human" rate (USD per Coin).
	useEffect(() => {
		if (isCustomRate || !exchangeRate || !exchangeRateType) return;

		const matchingOption = rateOptions.find((r) => r.type === exchangeRateType);
		if (!matchingOption) return;

		const systemRate = matchingOption.rate;
		if (systemRate === 0) return;

		const isActuallyCrypto = checkIsCrypto(watchedCurrency);

		// 1. "Big Crypto" Rubric Fix: Ensure major coins are shown as USD prices (> 1).
		if (
			isActuallyCrypto &&
			isMajorCrypto(watchedCurrency) &&
			exchangeRate < 1
		) {
			setExchangeRate((prev) => (prev && prev < 1 ? 1 / prev : prev));
			return;
		}

		// 2. Inversion Fix: If state is the inverse of DB.
		const currentRatio = exchangeRate * systemRate;
		if (currentRatio > 0.99 && currentRatio < 1.01) {
			// One is the inverse of the other.
			// We only flip if it would result in the "Corrected" state.
			if (isActuallyCrypto) {
				// For crypto, we want the "Big Number" (USD/Unit).
				if (exchangeRate < 1 && systemRate > 1) {
					setExchangeRate(systemRate);
				}
			} else {
				// For Fiat, we match the DB's orientation (Units/USD).
				if (Math.abs(exchangeRate - systemRate) > 0.000001) {
					setExchangeRate(systemRate);
				}
			}
		}
	}, [
		rateOptions,
		exchangeRate,
		exchangeRateType,
		isCustomRate,
		watchedCurrency,
	]);

	const usdEquivalent = useMemo(() => {
		const currentBalance = watchedBalance || 0;
		return toUSD(currentBalance, watchedCurrency, exchangeRate);
	}, [watchedBalance, watchedCurrency, exchangeRate, toUSD]);

	// Check if asset type is a liability
	const assetType = form.watch("type");
	const isLiability = useMemo(() => {
		return (
			assetType === AssetType.LIABILITY_LOAN ||
			assetType === AssetType.LIABILITY_CREDIT_CARD ||
			assetType === AssetType.LIABILITY_MORTGAGE
		);
	}, [assetType]);

	// Auto-check/uncheck isLiquid based on type
	useEffect(() => {
		const subscription = form.watch((value, { name }) => {
			if (name === "type") {
				if (value.type === AssetType.CASH) {
					form.setValue("isLiquid", true);
				} else if (
					value.type === AssetType.REAL_ESTATE ||
					value.type === AssetType.LIABILITY_MORTGAGE
				) {
					form.setValue("isLiquid", false);
				}
			}
		});
		return () => subscription.unsubscribe();
	}, [form]);

	// Form reset is handled by react-hook-form; useCurrencyInput syncs from form.watch()

	const createAsset = api.wealth.createAsset.useMutation({
		onSuccess: () => {
			toast.success("Asset created successfully");
			if (setOpen) setOpen(false);
			form.reset();
			void utils.wealth.getDashboard.invalidate();
		},
	});

	const updateAsset = api.wealth.updateAsset.useMutation({
		onSuccess: () => {
			toast.success("Asset updated successfully");
			if (setOpen) setOpen(false);
			void utils.wealth.getDashboard.invalidate();
		},
	});

	const deleteAsset = api.wealth.deleteAsset.useMutation({
		onSuccess: () => {
			toast.success("Asset deleted successfully");
			if (setOpen) setOpen(false);
			void utils.wealth.getDashboard.invalidate();
		},
	});

	const onSubmit = (data: FormValues) => {
		// Both are now stored exactly as displayed in state.
		const systemRate = exchangeRate;

		if (isEdit && assetId) {
			updateAsset.mutate({
				id: assetId,
				...data,
				exchangeRate: systemRate,
				exchangeRateType,
			});
		} else {
			createAsset.mutate({
				...data,
				exchangeRate: systemRate,
				exchangeRateType,
			});
		}
	};

	const handleCurrencyChange = (newCurrency: string) => {
		form.setValue("currency", newCurrency);
		// Always reset exchange rate when currency changes to prevent stale rates
		handleExchangeRateChange(undefined, undefined);
		setIsCustomRate(false);
	};

	const handleDelete = async () => {
		if (assetId) {
			setShowDeleteDialog(false);
			await deleteAsset.mutateAsync({ id: assetId });
		}
	};

	const defaultTrigger = (
		<Button>
			<Plus className="mr-2 h-4 w-4" />
			Add Asset
		</Button>
	);

	return (
		<>
			<ResponsiveDialog onOpenChange={setOpen} open={open}>
				{!isControlled && (
					<ResponsiveDialogTrigger asChild>{trigger || defaultTrigger}</ResponsiveDialogTrigger>
				)}
				<ResponsiveDialogContent className="sm:max-w-lg">
					<ResponsiveDialogHeader>
						<ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
						<ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
					</ResponsiveDialogHeader>
					<Form {...form}>
						<form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Name</FormLabel>
										<FormControl>
											<Input placeholder="e.g. Main Bank Asset" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="type"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Type</FormLabel>
										<Select
											defaultValue={field.value}
											onValueChange={field.onChange}
										>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder="Select type" />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value={AssetType.CASH}>Cash</SelectItem>
												<SelectItem value={AssetType.INVESTMENT}>
													Investment
												</SelectItem>
												<SelectItem value={AssetType.CRYPTO}>Crypto</SelectItem>
												<SelectItem value={AssetType.REAL_ESTATE}>
													Real Estate
												</SelectItem>
												<SelectItem value={AssetType.LIABILITY_LOAN}>
													Loan
												</SelectItem>
												<SelectItem value={AssetType.LIABILITY_CREDIT_CARD}>
													Credit Card
												</SelectItem>
												<SelectItem value={AssetType.LIABILITY_MORTGAGE}>
													Mortgage
												</SelectItem>
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							{/* Balance with Integrated Currency Picker */}
							<div className="space-y-4">
								<div className="space-y-2">
									<FormLabel>Balance</FormLabel>
									<div
										className={cn(
											"flex h-9 w-full overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
											form.formState.errors.balance && "border-destructive",
										)}
									>
										<FormField
											control={form.control}
											name="currency"
											render={({ field }) => (
												<CurrencyPicker
													onValueChange={handleCurrencyChange}
													triggerClassName="h-full rounded-none border-r border-input px-3 shrink-0 focus-visible:ring-0"
													triggerDisplay="flag+code"
													triggerVariant="ghost"
													value={field.value as CurrencyCode}
												/>
											)}
										/>
										<FormField
											control={form.control}
											name="balance"
											render={({ field }) => (
												<Input
													className="h-full w-full border-0 bg-transparent px-3 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
													placeholder="0.00"
													ref={field.ref}
													{...balanceInput.inputProps}
													onBlur={() => {
														balanceInput.handleBlur();
														field.onBlur();
													}}
												/>
											)}
										/>
									</div>
									<FormMessage />
								</div>

								{form.watch("currency") !== "USD" && (
									<div className="space-y-2">
										<FormLabel className="flex flex-wrap items-center">
											<span>Exchange Rate</span>
											{checkIsCrypto(watchedCurrency) && (
												<span className="ml-1 font-normal text-muted-foreground">
													(1 {watchedCurrency} = USD)
												</span>
											)}
										</FormLabel>
										<RateSelector
											currency={watchedCurrency}
											displayMode="foreign-to-default"
											homeCurrency="USD"
											isCustomSet={isCustomRate}
											onCustomCleared={() => setIsCustomRate(false)}
											onCustomClick={() => setIsCustomRate(true)}
											onCustomSet={() => setIsCustomRate(true)}
											onValueChange={handleExchangeRateChange}
											value={exchangeRate}
											variant="inline"
										/>
									</div>
								)}

								{/* USD Equivalent Preview */}
								{watchedBalance > 0 && (
									<div className="rounded-md bg-muted/50 p-3">
										<div className="flex items-center justify-between text-sm">
											<span className="text-muted-foreground">
												USD Equivalent:
											</span>
											<span className="font-medium">
												${formatNumber(usdEquivalent, 2)}
											</span>
										</div>
									</div>
								)}
							</div>

							{/* Conditional Interest Rate for Liabilities */}
							{isLiability && (
								<FormField
									control={form.control}
									name="interestRate"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Interest Rate (APR)</FormLabel>
											<FormControl>
												<Input
													placeholder="0.00"
													ref={field.ref}
													{...interestRateInput.inputProps}
													onBlur={() => {
														interestRateInput.handleBlur();
														field.onBlur();
													}}
												/>
											</FormControl>
											<FormDescription>
												Annual percentage rate for this liability.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}

							{/* Liquid Asset Checkbox - simplified */}
							<FormField
								control={form.control}
								name="isLiquid"
								render={({ field }) => (
									<FormItem className="flex flex-row items-start space-x-3 space-y-0">
										<FormControl>
											<Checkbox
												checked={field.value}
												onCheckedChange={field.onChange}
											/>
										</FormControl>
										<div className="space-y-1 leading-none">
											<FormLabel>Liquid Asset</FormLabel>
											<FormDescription className="text-xs">
												Can be easily converted to cash
											</FormDescription>
										</div>
									</FormItem>
								)}
							/>
							<ResponsiveDialogFooter>
								{/* Delete button - only visible in edit mode */}
								{isEdit && (
									<Button
										className="mr-auto h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
										disabled={deleteAsset.isPending}
										onClick={() => setShowDeleteDialog(true)}
										size="icon"
										type="button"
										variant="ghost"
									>
										<Trash2 className="h-4 w-4" />
										<span className="sr-only">Delete asset</span>
									</Button>
								)}
								<Button
									disabled={
										createAsset.isPending ||
										updateAsset.isPending ||
										deleteAsset.isPending
									}
									type="submit"
								>
									{createAsset.isPending || updateAsset.isPending
										? loadingLabel
										: submitLabel}
								</Button>
							</ResponsiveDialogFooter>
						</form>
					</Form>
				</ResponsiveDialogContent>
			</ResponsiveDialog>

			{/* Delete confirmation dialog */}
			<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
				<DialogContent className="w-full max-w-full sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Delete Asset</DialogTitle>
						<DialogDescription>
							This will permanently remove "{form.watch("name") || "this asset"}
							" from your portfolio. This action cannot be undone and will
							affect your net worth calculations.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => setShowDeleteDialog(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteAsset.isPending}
							onClick={handleDelete}
							variant="destructive"
						>
							{deleteAsset.isPending ? "Deleting..." : "Delete Asset"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
