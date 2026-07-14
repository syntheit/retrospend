"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
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
import { useCurrency } from "~/hooks/use-currency";
import { useCurrencyConversion } from "~/hooks/use-currency-conversion";
import { useCurrencyInput } from "~/hooks/use-currency-input";
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
	frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
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
	const t = useTranslations("recurring");
	const utils = api.useUtils();
	const { data: settings } = api.settings.getGeneral.useQuery();

	const { data: template } = api.recurring.get.useQuery(
		{ id: templateId ?? "" },
		{ enabled: !!templateId },
	);

	const createMutation = api.recurring.create.useMutation({
		onSuccess: () => {
			utils.recurring.list.invalidate();
			toast.success(t("subscriptionCreated"));
			onClose();
		},
		onError: () => {
			toast.error(t("subscriptionCreateFailed"));
		},
	});

	const updateMutation = api.recurring.update.useMutation({
		onSuccess: () => {
			utils.recurring.list.invalidate();
			toast.success(t("subscriptionUpdated"));
			onClose();
		},
		onError: () => {
			toast.error(t("subscriptionUpdateFailed"));
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

	const amountInput = useCurrencyInput({
		value: watchedAmount,
		onChange: (n) => setValue("amount", n, { shouldDirty: true }),
		currency: watchedCurrency,
	});

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
				categoryId: data.categoryId || undefined,
				websiteUrl: data.websiteUrl || undefined,
				paymentSource: data.paymentSource || undefined,
			});
		}
	};

	return (
		<Dialog onOpenChange={onClose} open={open}>
			<DialogContent
				className="top-4 left-1/2 h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] translate-x-[-50%] translate-y-0 overflow-y-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-none sm:w-full sm:max-w-md sm:-translate-y-1/2"
				onOpenAutoFocus={(e) => {
					if (window.innerWidth < 640) {
						e.preventDefault();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{templateId ? t("editSubscription") : t("newSubscription")}
					</DialogTitle>
					<DialogDescription>
						{templateId
							? t("editSubscriptionDescription")
							: t("newSubscriptionDescription")}
					</DialogDescription>
				</DialogHeader>

				<form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
					{/* Name */}
					<div className="space-y-2">
						<Label htmlFor="name">{t("fieldName")}</Label>
						<Input
							id="name"
							{...register("name")}
							placeholder={t("fieldNamePlaceholder")}
						/>
						{errors.name && (
							<p className="text-destructive text-sm">{errors.name.message}</p>
						)}
					</div>

					{/* Amount and Currency */}
					<div className="space-y-2">
						<Label htmlFor="amount">{t("fieldAmount")}</Label>
						<div
							className={cn(
								"flex h-9 w-full overflow-hidden rounded-lg border border-input bg-transparent shadow-xs dark:bg-input/30",
								"transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
								errors.amount && "border-destructive",
							)}
						>
							<CurrencyPicker
								onValueChange={(value) => setValue("currency", value)}
								triggerClassName="h-full rounded-none border-r border-input px-3 shrink-0 focus-visible:ring-0"
								triggerDisplay="flag+code"
								triggerVariant="ghost"
								value={watch("currency")}
							/>
							<div className="flex flex-1 items-center">
								<Input
									className="h-full w-full border-0 bg-transparent px-4 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
									id="amount"
									placeholder="0.00"
									{...amountInput.inputProps}
								/>
							</div>
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

					{/* Payment Source */}
					<div className="space-y-2">
						<Label htmlFor="paymentSource">{t("fieldPaymentSource")}</Label>
						<Input
							id="paymentSource"
							{...register("paymentSource")}
							placeholder={t("fieldPaymentSourcePlaceholder")}
						/>
						{errors.paymentSource && (
							<p className="text-destructive text-sm">
								{errors.paymentSource.message}
							</p>
						)}
					</div>

					{/* Website URL */}
					<div className="space-y-2">
						<Label htmlFor="websiteUrl">{t("fieldWebsiteUrl")}</Label>
						<Input
							id="websiteUrl"
							type="url"
							{...register("websiteUrl")}
							placeholder="https://..."
						/>
						{errors.websiteUrl && (
							<p className="text-destructive text-sm">
								{errors.websiteUrl.message}
							</p>
						)}
					</div>

					{/* Category */}
					<div className="space-y-2">
						<Label>{t("fieldCategory")}</Label>
						<CategoryPicker
							onValueChange={(value) => setValue("categoryId", value)}
							placeholder={t("fieldCategoryPlaceholder")}
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
						<Label htmlFor="recurring-frequency">{t("fieldFrequency")}</Label>
						<Select
							onValueChange={(value) =>
								setValue("frequency", value as RecurringFormData["frequency"])
							}
							value={watch("frequency")}
						>
							<SelectTrigger id="recurring-frequency">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="WEEKLY">{t("frequencyWeekly")}</SelectItem>
								<SelectItem value="BIWEEKLY">{t("frequencyBiweekly")}</SelectItem>
								<SelectItem value="MONTHLY">{t("frequencyMonthly")}</SelectItem>
								<SelectItem value="QUARTERLY">{t("frequencyQuarterly")}</SelectItem>
								<SelectItem value="YEARLY">{t("frequencyYearly")}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Next Due Date */}
					<div className="space-y-2">
						<Label>{t("fieldNextDueDate")}</Label>
						<DatePicker
							date={watch("nextDueDate")}
							onSelect={(date) => date && setValue("nextDueDate", date)}
						/>
					</div>

					{/* Auto Pay */}
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="space-y-0.5">
							<Label>{t("fieldAutoPay")}</Label>
							<p className="text-muted-foreground text-sm">
								{t("fieldAutoPayDescription")}
							</p>
						</div>
						<Switch
							checked={watch("autoPay")}
							onCheckedChange={(checked) => setValue("autoPay", checked)}
						/>
					</div>

					<DialogFooter>
						<Button onClick={onClose} type="button" variant="ghost">
							{t("cancel")}
						</Button>
						<Button
							disabled={createMutation.isPending || updateMutation.isPending}
							type="submit"
						>
							{createMutation.isPending || updateMutation.isPending
								? t("saving")
								: templateId
									? t("updateSubscription")
									: t("createSubscription")}
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
	const t = useTranslations("recurring");
	const { formatCurrency } = useCurrencyFormatter();
	const { usdToHomeRate } = useCurrency();
	const { toUSD, fromUSD } = useCurrencyConversion();

	if (currency === homeCurrency || !amount) return null;
	if (isLoading)
		return <p className="text-muted-foreground text-xs">{t("calculating")}</p>;

	if (!rate) return null;

	// 1. Convert to USD first
	const usdValue = toUSD(amount, currency, rate);

	// 2. Convert to home currency
	const estimation = fromUSD(usdValue, homeCurrency, usdToHomeRate ?? 1);

	return (
		<p className="fade-in slide-in-from-top-1 animate-in text-muted-foreground text-xs duration-300">
			{t("estimated", { amount: formatCurrency(estimation, homeCurrency) })}
		</p>
	);
}
