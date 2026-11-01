"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { fromMinor, money, toMinor } from "@retrospend/domain/money-minor";
import { draftFromMinor } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { MoneyInput } from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { RecurringCategoryField } from "~/components/recurring-category-field";
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
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import { api } from "~/trpc/react";
import { CurrencyEstimate } from "./recurring-estimate";

const recurringSchema = z.object({
	name: z.string().min(1, "Name is required"),
	amount: z.number().positive("Amount must be positive"),
	currency: z.string().length(3),
	categoryId: z.string().min(1, "Please select a category"),
	frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
	nextDueDate: z.date(),
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
	const locale = useMoneyLocale();
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
			paymentSource: "",
			autoPay: true,
		},
	});

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
				paymentSource: data.paymentSource || null,
			});
		} else {
			await createMutation.mutateAsync({
				...data,
				categoryId: data.categoryId || undefined,
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

				{/* Category */}
				<div className="space-y-2">
					<Label>{t("fieldCategory")}</Label>
					<RecurringCategoryField
						onChange={(id) => setValue("categoryId", id, { shouldValidate: true })}
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

				{/* Record automatically */}
				<div className="flex items-center justify-between gap-4">
					<Label htmlFor="recurring-auto-record">{t("fieldAutoPay")}</Label>
					<Switch
						checked={watch("autoPay")}
						id="recurring-auto-record"
						onCheckedChange={(checked) => setValue("autoPay", checked)}
					/>
				</div>
			</div>
		</Sheet>
	);
}
