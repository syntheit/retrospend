"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CurrencyPicker } from "~/components/currency-picker";
import { InlineExchangeRateSelector } from "~/components/inline-exchange-rate-selector";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import type { CurrencyCode } from "~/lib/currencies";
import { AssetType } from "~/lib/db-enums";
import { api } from "~/trpc/react";

const formSchema = z.object({
	name: z.string().min(1, "Name is required"),
	type: z.nativeEnum(AssetType),
	currency: z.string().length(3, "Currency must be 3 characters"),
	balance: z.coerce.number().min(0, "Balance must be positive"),
	exchangeRate: z.coerce.number().optional(),
	exchangeRateType: z.string().optional(),
	isLiquid: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

interface AssetDialogProps {
	mode: "create" | "edit";
	assetId?: string; // Required for edit mode
	initialValues?: Partial<FormValues>;
	trigger?: ReactNode;
	title?: string;
	description?: string;
	submitLabel?: string;
	loadingLabel?: string;
}

const createDefaults: FormValues = {
	name: "",
	type: AssetType.CASH,
	currency: "USD",
	balance: 0,
	isLiquid: false,
};

export function AssetDialog({
	mode,
	assetId,
	initialValues = {},
	trigger,
	title = mode === "create" ? "Add Asset" : "Edit Asset",
	description = mode === "create"
		? "Create a new asset to track your wealth."
		: "Update your asset details.",
	submitLabel = mode === "create" ? "Create Asset" : "Update Asset",
	loadingLabel = mode === "create" ? "Creating..." : "Updating...",
}: AssetDialogProps) {
	const [open, setOpen] = useState(false);
	const [exchangeRate, setExchangeRate] = useState<number | undefined>(
		initialValues.exchangeRate,
	);
	const [exchangeRateType, setExchangeRateType] = useState<string | undefined>(
		initialValues.exchangeRateType,
	);
	const [isCustomRate, setIsCustomRate] = useState(false);
	const utils = api.useUtils();

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues:
			mode === "create"
				? createDefaults
				: { ...createDefaults, ...initialValues },
	});

	// Reset form when initialValues change (for edit mode)
	useEffect(() => {
		if (mode === "edit" && initialValues) {
			form.reset({ ...createDefaults, ...initialValues });
			setExchangeRate(initialValues.exchangeRate);
			setExchangeRateType(initialValues.exchangeRateType);
			setIsCustomRate(false);
		}
	}, [initialValues, mode, form]);

	const createAsset = api.wealth.createAsset.useMutation({
		onSuccess: () => {
			toast.success("Asset created successfully");
			setOpen(false);
			form.reset();
			void utils.wealth.getDashboard.invalidate();
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const updateAsset = api.wealth.updateAsset.useMutation({
		onSuccess: () => {
			toast.success("Asset updated successfully");
			setOpen(false);
			void utils.wealth.getDashboard.invalidate();
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const onSubmit = (data: FormValues) => {
		if (mode === "create") {
			createAsset.mutate({
				...data,
				exchangeRate,
				exchangeRateType,
			});
		} else if (mode === "edit" && assetId) {
			updateAsset.mutate({
				id: assetId,
				...data,
				exchangeRate,
				exchangeRateType,
			});
		}
	};

	const handleCurrencyChange = (newCurrency: string) => {
		form.setValue("currency", newCurrency);
		if (newCurrency === "USD") {
			setExchangeRate(undefined);
			setExchangeRateType(undefined);
			setIsCustomRate(false);
		}
	};

	const defaultTrigger = (
		<Button>
			<Plus className="mr-2 h-4 w-4" />
			Add Asset
		</Button>
	);

	return (
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
						<div className="grid grid-cols-2 gap-4">
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
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>
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
						</div>
						{form.watch("currency") !== "USD" && (
							<div className="space-y-2">
								<FormLabel>Exchange Rate</FormLabel>
								<InlineExchangeRateSelector
									currency={form.watch("currency")}
									homeCurrency="USD"
									isCustomSet={isCustomRate}
									mode={false}
									onCustomCleared={() => setIsCustomRate(false)}
									onCustomSelected={() => setIsCustomRate(true)}
									onCustomSet={() => setIsCustomRate(true)}
									onValueChange={(rate, type) => {
										setExchangeRate(rate);
										setExchangeRateType(type);
									}}
									value={exchangeRate}
								/>
							</div>
						)}
						<FormField
							control={form.control}
							name="balance"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Balance</FormLabel>
									<FormControl>
										<Input step="0.01" type="number" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="isLiquid"
							render={({ field }) => (
								<FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
									<FormControl>
										<Checkbox
											checked={field.value}
											onCheckedChange={field.onChange}
										/>
									</FormControl>
									<div className="space-y-1 leading-none">
										<FormLabel>Liquid Asset</FormLabel>
										<FormDescription>
											This asset can be easily converted to cash.
										</FormDescription>
									</div>
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button
								disabled={createAsset.isPending || updateAsset.isPending}
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
	);
}

/*
Usage examples:

// Create mode (default)
<AssetDialog mode="create" />

// Edit mode with initial values
<AssetDialog
  mode="edit"
  assetId="asset-id-here"
  initialValues={{
    name: "My Bank Account",
    type: AssetType.CASH,
    currency: "USD",
    balance: 1000,
    isLiquid: true,
    exchangeRate: 1.0,
    exchangeRateType: "manual"
  }}
  title="Edit Asset"
  submitLabel="Update Asset"
/>
*/
