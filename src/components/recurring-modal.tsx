"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CategoryPicker } from "~/components/category-picker";
import { CurrencyPicker } from "~/components/currency-picker";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import { getSubscriptionMetadata } from "~/lib/subscription-metadata";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const recurringSchema = z.object({
	name: z.string().min(1, "Name is required"),
	amount: z.number().positive("Amount must be positive"),
	currency: z.string().length(3),
	categoryId: z.string().min(1, "Please select a category"),
	frequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]),
	nextDueDate: z.date(),
	websiteUrl: z.string().url().optional().or(z.literal("")),
	paymentSource: z.string().optional(),
	autoPay: z.boolean(),
});

type RecurringFormData = z.infer<typeof recurringSchema>;

interface RecurringModalProps {
	templateId?: string | null;
	open: boolean;
	onClose: () => void;
}

export function RecurringModal({
	templateId,
	open,
	onClose,
}: RecurringModalProps) {
	const utils = api.useUtils();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const { getCurrencySymbol } = useCurrencyFormatter();

	const { data: template } = api.recurring.get.useQuery(
		{ id: templateId ?? "" },
		{ enabled: !!templateId },
	);

	const createMutation = api.recurring.create.useMutation({
		onSuccess: () => {
			utils.recurring.list.invalidate();
			toast.success("Subscription created");
			onClose();
		},
		onError: () => {
			toast.error("Failed to create subscription");
		},
	});

	const updateMutation = api.recurring.update.useMutation({
		onSuccess: () => {
			utils.recurring.list.invalidate();
			toast.success("Subscription updated");
			onClose();
		},
		onError: () => {
			toast.error("Failed to update subscription");
		},
	});

	const {
		register,
		handleSubmit,
		watch,
		setValue,
		reset,
		formState: { errors },
	} = useForm<RecurringFormData>({
		resolver: zodResolver(recurringSchema),
		defaultValues: {
			name: "",
			amount: 0,
			currency: settings?.defaultCurrency ?? "USD",
			categoryId: "",
			frequency: "MONTHLY",
			nextDueDate: new Date(),
			websiteUrl: "",
			paymentSource: "",
			autoPay: true,
		},
	});

	const watchedName = watch("name");
	const watchedWebsiteUrl = watch("websiteUrl");

	// Auto-fill website URL based on subscription name
	useEffect(() => {
		if (watchedName && !watchedWebsiteUrl && !templateId) {
			const metadata = getSubscriptionMetadata(watchedName);
			if (metadata?.url) {
				setValue("websiteUrl", metadata.url);
			}
		}
	}, [watchedName, watchedWebsiteUrl, setValue, templateId]);

	// Load template data for editing
	useEffect(() => {
		if (template) {
			reset({
				name: template.name,
				amount: Number(template.amount),
				currency: template.currency,
				categoryId: template.categoryId ?? "",
				frequency: template.frequency,
				nextDueDate: new Date(template.nextDueDate),
				websiteUrl: template.websiteUrl ?? "",
				paymentSource: template.paymentSource ?? "",
				autoPay: template.autoPay,
			});
		}
	}, [template, reset]);

	const watchedCurrency = watch("currency");
	const watchedAmount = watch("amount");
	const homeCurrency = settings?.homeCurrency ?? "USD";

	const { getDefaultRate, isLoading: isRateLoading } = useExchangeRates({
		currency: watchedCurrency,
		enabled: watchedCurrency !== homeCurrency && !!watchedAmount,
		preferFavorites: true,
	});

	const activeRate = getDefaultRate();

	const onSubmit = async (data: RecurringFormData) => {
		if (templateId) {
			await updateMutation.mutateAsync({
				id: templateId,
				...data,
				categoryId: data.categoryId || null,
				websiteUrl: data.websiteUrl || null,
				paymentSource: data.paymentSource || null,
			});
		} else {
			await createMutation.mutateAsync({
				...data,
				...data,
				categoryId: data.categoryId || undefined,
				websiteUrl: data.websiteUrl || undefined,
				paymentSource: data.paymentSource || undefined,
			});
		}
	};

	return (
		<Dialog onOpenChange={onClose} open={open}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>
						{templateId ? "Edit Subscription" : "New Subscription"}
					</DialogTitle>
					<DialogDescription>
						{templateId
							? "Update your recurring expense details"
							: "Add a new recurring expense or subscription"}
					</DialogDescription>
				</DialogHeader>

				<form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
					{/* Name */}
					<div className="space-y-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							{...register("name")}
							placeholder="e.g., Netflix, Rent, Gym"
						/>
						{errors.name && (
							<p className="text-destructive text-sm">{errors.name.message}</p>
						)}
					</div>

					{/* Amount and Currency */}
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
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
									{getCurrencySymbol(watch("currency"))}
								</span>
								<Input
									className="h-full w-full grow border-0 bg-transparent px-0 py-0 font-bold text-lg shadow-none focus-visible:ring-0 sm:text-2xl dark:bg-transparent"
									id="amount"
									placeholder="0.00"
									step="0.01"
									type="number"
									{...register("amount", { valueAsNumber: true })}
								/>
							</div>
							<CurrencyEstimate
								amount={watchedAmount}
								currency={watchedCurrency}
								homeCurrency={homeCurrency}
								isLoading={isRateLoading}
								rate={activeRate?.rate}
							/>
							{errors.amount && (
								<p className="text-destructive text-sm">
									{errors.amount.message}
								</p>
							)}
						</div>

						<div className="space-y-2">
							<Label>Currency</Label>
							<CurrencyPicker
								onValueChange={(value) => setValue("currency", value)}
								value={watch("currency")}
							/>
						</div>
					</div>
					
					{/* Payment Source */}
					<div className="space-y-2">
						<Label htmlFor="paymentSource">Payment Source</Label>
						<Input
							id="paymentSource"
							{...register("paymentSource")}
							placeholder="e.g. Chase Checking"
						/>
						{errors.paymentSource && (
							<p className="text-destructive text-sm">{errors.paymentSource.message}</p>
						)}
					</div>

					{/* Category */}
					<div className="space-y-2">
						<Label>Category</Label>
						<CategoryPicker
							onValueChange={(value) => setValue("categoryId", value)}
							placeholder="Select category"
							value={watch("categoryId")}
						/>
						{errors.categoryId && (
							<p className="text-destructive text-sm">
								{errors.categoryId.message}
							</p>
						)}
					</div>

					{/* Frequency */}
					<div className="space-y-2">
						<Label>Frequency</Label>
						<Select
							onValueChange={(value) =>
								setValue("frequency", value as "WEEKLY" | "MONTHLY" | "YEARLY")
							}
							value={watch("frequency")}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="WEEKLY">Weekly</SelectItem>
								<SelectItem value="MONTHLY">Monthly</SelectItem>
								<SelectItem value="YEARLY">Yearly</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Next Due Date */}
					<div className="space-y-2">
						<Label>Next Due Date</Label>
						<DatePicker
							date={watch("nextDueDate")}
							onSelect={(date) => date && setValue("nextDueDate", date)}
						/>
					</div>

					{/* Auto Pay */}
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="space-y-0.5">
							<Label>Auto Pay</Label>
							<p className="text-muted-foreground text-sm">
								Automatically create expenses when due
							</p>
						</div>
						<Switch
							checked={watch("autoPay")}
							onCheckedChange={(checked) => setValue("autoPay", checked)}
						/>
					</div>

					<DialogFooter>
						<Button onClick={onClose} type="button" variant="ghost">
							Cancel
						</Button>
						<Button
							disabled={createMutation.isPending || updateMutation.isPending}
							type="submit"
						>
							{createMutation.isPending || updateMutation.isPending
								? "Saving..."
								: templateId
									? "Update"
									: "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function CurrencyEstimate({
	amount,
	currency,
	homeCurrency,
	rate,
	isLoading,
}: {
	amount: number;
	currency: string;
	homeCurrency: string;
	rate?: number;
	isLoading: boolean;
}) {
	const { formatCurrency } = useCurrencyFormatter();

	if (currency === homeCurrency || !amount) return null;
	if (isLoading)
		return <p className="text-muted-foreground text-xs">Calculating...</p>;

	if (!rate) return null;

	const estimation = amount / rate;

	return (
		<p className="fade-in slide-in-from-top-1 animate-in text-muted-foreground text-xs duration-300">
			Estimated ~ {formatCurrency(estimation, homeCurrency)}
		</p>
	);
}
