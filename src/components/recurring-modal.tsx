"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { tryConvertAmount } from "@retrospend/domain/money";
import { fromMinor, money, toMinor } from "@retrospend/domain/money-minor";
import { draftFromMinor } from "@retrospend/domain/parse";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CategoryPicker } from "~/components/category-picker";
import { MoneyInput } from "~/components/money/money-input";
import { Button } from "~/components/ui/button";
import { DatePicker } from "~/components/ui/date-picker";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Sheet } from "~/components/ui/sheet";
import { Switch } from "~/components/ui/switch";
import { useToast } from "~/components/ui/toast";
import { useCurrency } from "~/hooks/use-currency";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import { getSubscriptionMetadata } from "~/lib/subscription-metadata";
import { api } from "~/trpc/react";

const recurringSchema = z.object({
	name: z.string().min(1, "Name is required"),
	amount: z.number().positive("Amount must be positive"),
	currency: z.string().length(3),
	categoryId: z.string().min(1, "Please select a category"),
	frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
	nextDueDate: z.date(),
	websiteUrl: z.url().optional().or(z.literal("")),
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
	const locale = useLocale();
	const [amountText, setAmountText] = useState("");
	const toast = useToast();
	const utils = api.useUtils();
	const { data: settings } = api.settings.getGeneral.useQuery();

	const { data: template } = api.recurring.get.useQuery(
		{ id: templateId ?? "" },
		{ enabled: !!templateId },
	);

	const createMutation = api.recurring.create.useMutation({
		onSuccess: () => {
			utils.recurring.list.invalidate();
			toast.saved(t("subscriptionCreated"));
		},
		onError: () => {
			toast.failed(t("subscriptionCreateFailed"));
		},
	});

	const updateMutation = api.recurring.update.useMutation({
		onSuccess: () => {
			utils.recurring.list.invalidate();
			toast.saved(t("subscriptionUpdated"));
		},
		onError: () => {
			toast.failed(t("subscriptionUpdateFailed"));
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
			setAmountText(
				draftFromMinor(
					toMinor(String(template.amount), template.currency),
					locale,
					template.currency,
				),
			);
		}
	}, [template, reset, locale]);

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
				categoryId: data.categoryId || undefined,
				websiteUrl: data.websiteUrl || undefined,
				paymentSource: data.paymentSource || undefined,
			});
		}
	};

	// The sheet closes itself after a good save; an invalid form keeps it open.
	const submitSheet = async () => {
		let saved = false;
		try {
			await handleSubmit(async (data) => {
				await onSubmit(data);
				saved = true;
			})();
		} catch {
			return false;
		}
		return saved;
	};

	return (
		<Sheet
			description={
				templateId
					? t("editSubscriptionDescription")
					: t("newSubscriptionDescription")
			}
			onOpenChange={(next) => !next && onClose()}
			onSubmit={submitSheet}
			open={open}
			submitLabel={
				templateId ? t("updateSubscription") : t("createSubscription")
			}
			title={templateId ? t("editSubscription") : t("newSubscription")}
		>
			<div className="space-y-4">
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
					<MoneyInput
						currency={watchedCurrency}
						id="amount"
						onChange={(text, result) => {
							setAmountText(text);
							setValue(
								"amount",
								result.ok
									? Number(fromMinor(money(result.minor, watchedCurrency)))
									: 0,
								{ shouldDirty: true },
							);
						}}
						onCurrencyChange={(value) => setValue("currency", value)}
						value={amountText}
					/>
					<CurrencyEstimate
						amount={watchedAmount}
						currency={watchedCurrency}
						homeCurrency={homeCurrency}
						isLoading={isRateLoading}
						rate={activeRate?.rate}
					/>
					{errors.amount && (
						<p className="text-destructive text-sm">{errors.amount.message}</p>
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
							<SelectItem value="QUARTERLY">
								{t("frequencyQuarterly")}
							</SelectItem>
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
			</div>
		</Sheet>
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

	if (currency === homeCurrency || !amount) return null;
	if (isLoading)
		return <p className="text-muted-foreground text-xs">{t("calculating")}</p>;

	// No estimate until both rates are known (never assume 1)
	const estimation = tryConvertAmount(
		amount,
		currency,
		rate,
		homeCurrency,
		usdToHomeRate,
	);
	if (estimation === null) return null;

	return (
		<p className="fade-in slide-in-from-top-1 animate-in text-muted-foreground text-xs duration-300">
			{t("estimated", { amount: formatCurrency(estimation, homeCurrency) })}
		</p>
	);
}
