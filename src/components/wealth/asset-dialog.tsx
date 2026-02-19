"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
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
	DialogTrigger,
} from "~/components/ui/dialog";
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
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import type { CurrencyCode } from "~/lib/currencies";
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

	// Initialize with INVERTED rate for non-USD currencies because we want to display/edit
	// the "Human" rate (e.g. 0.0007 USD/ARS), but DB stores "System" rate (e.g. 1430 ARS/USD).
	const [exchangeRate, setExchangeRate] = useState<number | undefined>(() => {
		if (
			initialValues?.exchangeRate &&
			initialValues.currency &&
			initialValues.currency !== "USD"
		) {
			return 1 / initialValues.exchangeRate;
		}
		return initialValues?.exchangeRate;
	});
	const [exchangeRateType, setExchangeRateType] = useState<string | undefined>(
		initialValues?.exchangeRateType,
	);
	const [isCustomRate, setIsCustomRate] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const { getCurrencySymbol } = useCurrencyFormatter();
	const utils = api.useUtils();

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: isEdit
			? { ...createDefaults, ...initialValues }
			: createDefaults,
	});

	// Fetch rates to validate and auto-correct potential inversion bugs
	const { rateOptions } = useExchangeRates({
		currency: form.watch("currency"),
		enabled: open && form.watch("currency") !== "USD",
	});

	// Auto-correct potential inverse rate bug on load
	// If the state rate matches the "System" rate (Units/USD), it means it wasn't inverted correctly
	// or the source data was already inverted. We expect "Human" rate (USD/Unit).
	useEffect(() => {
		if (isCustomRate || !exchangeRate || !exchangeRateType) return;

		const matchingOption = rateOptions.find((r) => r.type === exchangeRateType);

		if (matchingOption) {
			const systemRate = matchingOption.rate;
			// Avoid division by zero
			if (systemRate === 0) return;

			const currentRatio = exchangeRate / systemRate;

			// If State ≈ System Rate (within 1% tolerance), it requires inversion
			if (currentRatio > 0.99 && currentRatio < 1.01) {
				const correctedRate = 1 / exchangeRate;
				// Console log for debugging (optional, removing for prod cleanliness if desired)
				// console.log("Auto-correcting inverted exchange rate", exchangeRate, "->", correctedRate);
				setExchangeRate(correctedRate);
			}
		}
	}, [rateOptions, exchangeRate, exchangeRateType, isCustomRate]);

	// Calculate USD equivalent
	const balance = form.watch("balance");
	const currency = form.watch("currency");

	const usdEquivalent = useMemo(() => {
		const currentBalance = balance || 0;
		if (currency === "USD") return currentBalance;
		// Exchange rate is in "Human" format (USD per Unit) -> Multiply
		// Wait, previous logic was multiplying by System Rate (Units per USD)?
		// No, previously it multiplied by stored rate.
		// If stored rate was 1430 -> 1.4 Million.
		// If stored rate was 0.0007 -> 0.7.
		// NOW we ensure state is 0.0007.
		// So multiplying is correct for Human Rate.
		return currentBalance * (exchangeRate ?? 1);
	}, [balance, currency, exchangeRate]);

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
		// Invert rate back to System format (Units per USD) before saving
		let systemRate = exchangeRate;
		if (
			data.currency !== "USD" &&
			exchangeRate !== undefined &&
			exchangeRate > 0
		) {
			systemRate = 1 / exchangeRate;
		}

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
		setExchangeRate(undefined);
		setExchangeRateType(undefined);
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
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
				<DialogContent className="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{description}</DialogDescription>
					</DialogHeader>
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

							{/* Currency and Exchange Rate Group */}
							<div className="space-y-4">
								<div className="grid grid-cols-2 gap-4">
									<FormField
										control={form.control}
										name="currency"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Currency</FormLabel>
												<FormControl>
													<CurrencyPicker
														onValueChange={handleCurrencyChange}
														placeholder="Select currency"
														value={field.value as CurrencyCode}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="balance"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Balance</FormLabel>
												<FormControl>
													<div
														className={cn(
															"flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
															"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
														)}
													>
														<span className="shrink-0 font-medium text-muted-foreground">
															{getCurrencySymbol(form.watch("currency"))}
														</span>
														<Input
															className="h-full w-full border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
															step="0.01"
															type="number"
															{...field}
														/>
													</div>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>

								{form.watch("currency") !== "USD" && (
									<div className="space-y-2">
										<FormLabel>Exchange Rate</FormLabel>
										<RateSelector
											currency={form.watch("currency")}
											displayMode="foreign-to-default"
											homeCurrency="USD"
											isCustomSet={isCustomRate}
											onCustomCleared={() => setIsCustomRate(false)}
											onCustomClick={() => setIsCustomRate(true)}
											onCustomSet={() => setIsCustomRate(true)}
											onValueChange={(
												rate: number | undefined,
												type?: string,
											) => {
												setExchangeRate(rate);
												setExchangeRateType(type);
											}}
											value={exchangeRate}
											variant="inline"
										/>
									</div>
								)}

								{/* USD Equivalent Preview */}
								{form.watch("balance") > 0 && (
									<div className="rounded-md bg-muted/50 p-3">
										<div className="flex items-center justify-between text-sm">
											<span className="text-muted-foreground">
												USD Equivalent:
											</span>
											<span className="font-medium">
												$
												{usdEquivalent.toLocaleString("en-US", {
													minimumFractionDigits: 2,
													maximumFractionDigits: 2,
												})}
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
													onChange={(e) => {
														const value =
															e.target.value === ""
																? undefined
																: parseFloat(e.target.value);
														field.onChange(value);
													}}
													placeholder="0.00"
													step="0.01"
													type="number"
													value={field.value ?? ""}
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
							<DialogFooter>
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
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>

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
							{deleteAsset.isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
