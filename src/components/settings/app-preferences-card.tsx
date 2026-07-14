"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CurrencyPicker } from "~/components/currency-picker";
import { useThemeContext } from "~/components/theme-provider";
import { setLocaleCookie } from "~/i18n/actions";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Form, FormControl, FormField } from "~/components/ui/form";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import {
	CRYPTO_CURRENCIES,
	CURRENCIES,
	type CurrencyCode,
} from "~/lib/currencies";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const LANGUAGE_OPTIONS = [
	{ value: "en", label: "English", flag: "EN" },
	{ value: "es", label: "Español", flag: "ES" },
] as const;

const currencyCodeSchema = z
	.string()
	.refine(
		(val): val is CurrencyCode => val in CURRENCIES || val in CRYPTO_CURRENCIES,
		{ message: "Invalid currency code" },
	);

const allPreferencesSchema = z.object({
	homeCurrency: currencyCodeSchema,
	defaultCurrency: currencyCodeSchema,
	monthlyIncome: z
		.string()
		.optional()
		.refine(
			(val) => !val?.trim() || !isNaN(parseFloat(val)),
			"Must be a valid number",
		)
		.refine(
			(val) => !val?.trim() || parseFloat(val) >= 0,
			"Must be a non-negative number",
		),
	monthlyIncomeCurrency: currencyCodeSchema,
	smartCurrencyFormatting: z.boolean(),
	defaultPrivacyMode: z.boolean(),
	fiscalMonthStartDay: z.number().int().min(1).max(28),
	categoryClickBehavior: z.enum(["navigate", "toggle"]),
	currencySymbolStyle: z.enum(["native", "standard"]),
	defaultExpenseDateBehavior: z.enum(["TODAY", "LAST_USED"]),
});

type AllPreferencesValues = z.infer<typeof allPreferencesSchema>;

function SectionHeader({ children }: { children: React.ReactNode }) {
	return (
		<p className="pb-2 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
			{children}
		</p>
	);
}

function SettingRow({
	label,
	description,
	children,
}: {
	label: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between py-3">
			<div className="min-w-0 flex-1 pr-4">
				<div className="text-sm font-medium">{label}</div>
				{description && (
					<div className="text-xs text-muted-foreground">{description}</div>
				)}
			</div>
			<div className="flex-shrink-0">{children}</div>
		</div>
	);
}

function ThemeToggle({
	value,
	onChange,
	labels,
}: {
	value: string;
	onChange: (v: "light" | "dark" | "auto") => void;
	labels: { light: string; dark: string; system: string };
}) {
	return (
		<Tabs value={value} onValueChange={(v) => onChange(v as "light" | "dark" | "auto")}>
			<TabsList>
				<TabsTrigger value="light">{labels.light}</TabsTrigger>
				<TabsTrigger value="dark">{labels.dark}</TabsTrigger>
				<TabsTrigger value="auto">{labels.system}</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}

export function AppPreferencesContent() {
	const t = useTranslations("settings");
	const { setTheme, preference: themePreference } = useThemeContext();

	const { data: settings, isLoading: settingsLoading } =
		api.settings.getGeneral.useQuery();

	const updateSettingsMutation = api.settings.updateGeneral.useMutation();

	const form = useForm<AllPreferencesValues>({
		resolver: zodResolver(allPreferencesSchema),
		defaultValues: {
			homeCurrency: "USD",
			defaultCurrency: "USD",
			monthlyIncome: "",
			monthlyIncomeCurrency: "USD" as CurrencyCode,
			smartCurrencyFormatting: true,
			defaultPrivacyMode: false,
			fiscalMonthStartDay: 1,
			categoryClickBehavior: "toggle",
			currencySymbolStyle: "standard",
			defaultExpenseDateBehavior: "TODAY",
		},
	});

	useEffect(() => {
		if (settings) {
			form.reset({
				homeCurrency: (settings.homeCurrency as CurrencyCode) || "USD",
				defaultCurrency:
					(settings.defaultCurrency as CurrencyCode) ||
					(settings.homeCurrency as CurrencyCode) ||
					"USD",
				monthlyIncome: settings.monthlyIncome
					? settings.monthlyIncome.toString()
					: "",
				monthlyIncomeCurrency:
					(settings.monthlyIncomeCurrency as CurrencyCode) ||
					(settings.homeCurrency as CurrencyCode) ||
					"USD",
				smartCurrencyFormatting: settings.smartCurrencyFormatting ?? true,
				defaultPrivacyMode: settings.defaultPrivacyMode ?? false,
				fiscalMonthStartDay: settings.fiscalMonthStartDay ?? 1,
				categoryClickBehavior: settings.categoryClickBehavior || "toggle",
				currencySymbolStyle: settings.currencySymbolStyle || "standard",
				defaultExpenseDateBehavior:
					settings.defaultExpenseDateBehavior || "TODAY",
			});
		}
	}, [settings, form]);

	const utils = api.useUtils();

	const onSubmit = useCallback(
		async (values: AllPreferencesValues) => {
			try {
				const monthlyIncomeValue = values.monthlyIncome?.trim()
					? parseFloat(values.monthlyIncome)
					: undefined;

				if (!settings) return;

				await updateSettingsMutation.mutateAsync({
					homeCurrency: values.homeCurrency,
					defaultCurrency: values.defaultCurrency,
					monthlyIncome: monthlyIncomeValue,
					monthlyIncomeCurrency: values.monthlyIncomeCurrency,
					smartCurrencyFormatting: values.smartCurrencyFormatting,
					defaultPrivacyMode: values.defaultPrivacyMode,
					fiscalMonthStartDay: values.fiscalMonthStartDay,
					categoryClickBehavior: values.categoryClickBehavior,
					currencySymbolStyle: values.currencySymbolStyle,
					defaultExpenseDateBehavior: values.defaultExpenseDateBehavior,
				});

				await utils.settings.getGeneral.invalidate();
				form.reset(values);
				toast.success(t("preferencesUpdated"));
			} catch (err) {
				const errMsg =
					err instanceof Error ? err.message : "Failed to save settings";
				toast.error(errMsg);
			}
		},
		[settings, updateSettingsMutation, form, utils, t],
	);

	const onSubmitRef = useRef(onSubmit);
	onSubmitRef.current = onSubmit;

	const save = useCallback(() => {
		void form.handleSubmit(onSubmitRef.current)();
	}, [form]);

	const handleLanguageChange = async (value: string) => {
		if (!settings) return;
		try {
			await updateSettingsMutation.mutateAsync({
				homeCurrency: settings.homeCurrency,
				language: value as "en" | "es",
			});
			// Set the locale cookie via server action and reload so next-intl picks up the new locale
			await setLocaleCookie(value);
			window.location.reload();
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to update language",
			);
		}
	};

	if (settingsLoading) {
		return (
			<div className="py-4 text-center text-muted-foreground">
				{t("loadingPreferences")}
			</div>
		);
	}

	const currentLanguage = settings?.language ?? "en";

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)}>
				{/* Regional */}
				<SectionHeader>{t("regional")}</SectionHeader>
				<div className="divide-y divide-border/40">
					<FormField
						control={form.control}
						name="homeCurrency"
						render={({ field }) => (
							<SettingRow
								label={t("baseCurrency")}
								description={t("baseCurrencyDescription")}
							>
								<FormControl>
									<CurrencyPicker
										onValueChange={(value) => {
											field.onChange(value);
											save();
										}}
										placeholder="Select currency"
										triggerClassName="min-w-[180px]"
										value={field.value}
									/>
								</FormControl>
							</SettingRow>
						)}
					/>

					<FormField
						control={form.control}
						name="defaultCurrency"
						render={({ field }) => (
							<SettingRow
								label={t("defaultEntryCurrency")}
								description={t("defaultEntryCurrencyDescription")}
							>
								<FormControl>
									<CurrencyPicker
										onValueChange={(value) => {
											field.onChange(value);
											save();
										}}
										placeholder="Select currency"
										triggerClassName="min-w-[180px]"
										value={field.value}
									/>
								</FormControl>
							</SettingRow>
						)}
					/>

					<FormField
						control={form.control}
						name="currencySymbolStyle"
						render={({ field }) => (
							<SettingRow
								label={t("currencySymbolStyle")}
								description={t("currencySymbolStyleDescription")}
							>
								<Select
									onValueChange={(value) => {
										field.onChange(value);
										save();
									}}
									value={field.value}
								>
									<FormControl>
										<SelectTrigger className="min-w-[180px]">
											<SelectValue />
										</SelectTrigger>
									</FormControl>
									<SelectContent>
										<SelectItem value="standard">
											{t("currencySymbolStandard")}
										</SelectItem>
										<SelectItem value="native">{t("currencySymbolNative")}</SelectItem>
									</SelectContent>
								</Select>
							</SettingRow>
						)}
					/>

					<FormField
						control={form.control}
						name="smartCurrencyFormatting"
						render={({ field }) => (
							<SettingRow
								label={t("smartCurrencyFormatting")}
								description={t("smartCurrencyFormattingDescription")}
							>
								<FormControl>
									<Switch
										checked={field.value}
										onCheckedChange={(checked) => {
											field.onChange(checked);
											save();
										}}
									/>
								</FormControl>
							</SettingRow>
						)}
					/>
				</div>

				{/* Budget & income */}
				<SectionHeader>{t("budgetAndIncome")}</SectionHeader>
				<div className="divide-y divide-border/40">
					<FormField
						control={form.control}
						name="monthlyIncome"
						render={({ field }) => (
							<SettingRow
								label={t("monthlyNetIncome")}
								description={t("monthlyNetIncomeDescription")}
							>
								<div
									className={cn(
										"flex h-9 overflow-hidden rounded-md border border-input shadow-xs",
										"transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
										"dark:bg-input/30",
									)}
								>
									<CurrencyPicker
										onValueChange={(value) => {
											form.setValue("monthlyIncomeCurrency", value);
											save();
										}}
										triggerClassName="h-full rounded-none border-r border-input px-2 shrink-0 focus-visible:ring-0"
										triggerDisplay="flag+code"
										triggerVariant="ghost"
										value={form.watch("monthlyIncomeCurrency")}
									/>
									<FormControl>
										<Input
											className="h-full w-28 border-0 bg-transparent px-2 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
											placeholder="5000"
											type="number"
											{...field}
											onBlur={() => {
												field.onBlur();
												if (form.formState.isDirty) save();
											}}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													e.preventDefault();
													save();
												}
											}}
										/>
									</FormControl>
								</div>
							</SettingRow>
						)}
					/>

					<FormField
						control={form.control}
						name="fiscalMonthStartDay"
						render={({ field }) => (
							<SettingRow
								label={t("budgetCycleStartDay")}
								description={t("budgetCycleStartDayDescription")}
							>
								<FormControl>
									<Input
										className="w-14 text-center"
										max={28}
										min={1}
										type="number"
										value={field.value}
										onBlur={() => {
											field.onBlur();
											save();
										}}
										onChange={(e) => {
											const val = parseInt(e.target.value, 10);
											if (!isNaN(val) && val >= 1 && val <= 28) {
												field.onChange(val);
											}
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												save();
											}
										}}
									/>
								</FormControl>
							</SettingRow>
						)}
					/>
				</div>

				{/* Display */}
				<SectionHeader>{t("display")}</SectionHeader>
				<div className="divide-y divide-border/40">
					<SettingRow label={t("theme")} description={t("themeDescription")}>
						<ThemeToggle
							onChange={(v) => setTheme(v)}
							value={themePreference}
							labels={{
								light: t("themeLight"),
								dark: t("themeDark"),
								system: t("themeSystem"),
							}}
						/>
					</SettingRow>

					<SettingRow label={t("language")} description={t("languageDescription")}>
						<LanguagePicker
							value={currentLanguage}
							onValueChange={handleLanguageChange}
						/>
					</SettingRow>

					<FormField
						control={form.control}
						name="defaultPrivacyMode"
						render={({ field }) => (
							<SettingRow
								label={t("defaultPrivacyMode")}
								description={t("defaultPrivacyModeDescription")}
							>
								<FormControl>
									<Switch
										checked={field.value}
										onCheckedChange={(checked) => {
											field.onChange(checked);
											save();
										}}
									/>
								</FormControl>
							</SettingRow>
						)}
					/>
				</div>

				{/* Behavior */}
				<SectionHeader>{t("behavior")}</SectionHeader>
				<div className="divide-y divide-border/40">
					<FormField
						control={form.control}
						name="defaultExpenseDateBehavior"
						render={({ field }) => (
							<SettingRow
								label={t("defaultExpenseDate")}
								description={t("defaultExpenseDateDescription")}
							>
								<Select
									onValueChange={(value) => {
										field.onChange(value);
										save();
									}}
									value={field.value}
								>
									<FormControl>
										<SelectTrigger className="min-w-[180px]">
											<SelectValue />
										</SelectTrigger>
									</FormControl>
									<SelectContent>
										<SelectItem value="TODAY">{t("expenseDateToday")}</SelectItem>
										<SelectItem value="LAST_USED">{t("expenseDateLastUsed")}</SelectItem>
									</SelectContent>
								</Select>
							</SettingRow>
						)}
					/>

					<FormField
						control={form.control}
						name="categoryClickBehavior"
						render={({ field }) => (
							<SettingRow
								label={t("categoryClickBehavior")}
								description={t("categoryClickBehaviorDescription")}
							>
								<Select
									onValueChange={(value) => {
										field.onChange(value);
										save();
									}}
									value={field.value}
								>
									<FormControl>
										<SelectTrigger className="min-w-[180px]">
											<SelectValue />
										</SelectTrigger>
									</FormControl>
									<SelectContent>
										<SelectItem value="navigate">
											{t("categoryClickNavigate")}
										</SelectItem>
										<SelectItem value="toggle">
											{t("categoryClickToggle")}
										</SelectItem>
									</SelectContent>
								</Select>
							</SettingRow>
						)}
					/>

					<AiProcessingRow />
				</div>
			</form>
		</Form>
	);
}

function LanguagePicker({
	value,
	onValueChange,
}: {
	value: string;
	onValueChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const selectedOption = useMemo(
		() => LANGUAGE_OPTIONS.find((opt) => opt.value === value),
		[value],
	);

	const filteredOptions = useMemo(() => {
		if (!search) return LANGUAGE_OPTIONS;
		const searchLower = search.toLowerCase();
		return LANGUAGE_OPTIONS.filter(
			(opt) =>
				opt.label.toLowerCase().includes(searchLower) ||
				opt.value.toLowerCase().includes(searchLower),
		);
	}, [search]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className="min-w-[180px] justify-between"
				>
					{selectedOption ? (
						<span className="inline-flex items-center gap-2">
							<span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold leading-none">
								{selectedOption.flag}
							</span>
							{selectedOption.label}
						</span>
					) : (
						"Select language..."
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(18rem,calc(100vw-3rem))] p-0">
				<div className="p-2">
					<Input
						placeholder="Search languages..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="mb-2"
					/>
				</div>
				<div
					className="max-h-64 overflow-y-auto"
					onWheel={(e) => e.stopPropagation()}
				>
					{filteredOptions.length === 0 ? (
						<div className="p-4 text-center text-muted-foreground">
							No languages found.
						</div>
					) : (
						filteredOptions.map((opt) => (
							<div
								key={opt.value}
								role="option"
								aria-selected={value === opt.value}
								tabIndex={0}
								className={cn(
									"flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-accent hover:text-accent-foreground",
									value === opt.value && "bg-accent text-accent-foreground",
								)}
								onClick={() => {
									onValueChange(opt.value);
									setOpen(false);
									setSearch("");
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										onValueChange(opt.value);
										setOpen(false);
										setSearch("");
									}
								}}
							>
								<Check
									className={cn(
										"h-4 w-4",
										value === opt.value ? "opacity-100" : "opacity-0",
									)}
								/>
								<span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold leading-none">
									{opt.flag}
								</span>
								{opt.label}
							</div>
						))
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function AiProcessingRow() {
	const t = useTranslations("settings");
	const { data: aiStatus } = api.settings.getAiStatus.useQuery();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const updateSettingsMutation = api.settings.updateGeneral.useMutation();
	const utils = api.useUtils();

	if (!settings) return null;

	const handleAiModeChange = async (value: string) => {
		try {
			await updateSettingsMutation.mutateAsync({
				homeCurrency: settings.homeCurrency,
				aiMode: value as "LOCAL" | "EXTERNAL",
			});
			await utils.settings.getGeneral.invalidate();
			await utils.settings.getAiStatus.invalidate();
			toast.success(t("aiModeUpdated"));
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : t("aiModeUpdateFailed"),
			);
		}
	};

	return (
		<SettingRow
			label={t("aiProcessing")}
			description={t("aiProcessingDescription")}
		>
			<div className="flex flex-col items-end gap-1">
				<Select
					disabled={updateSettingsMutation.isPending}
					onValueChange={handleAiModeChange}
					value={settings.aiMode ?? "LOCAL"}
				>
					<SelectTrigger className="min-w-[180px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="LOCAL">{t("aiLocal")}</SelectItem>
						<SelectItem
							disabled={!aiStatus?.externalAvailable}
							value="EXTERNAL"
						>
							{t("aiExternal")}
							{aiStatus &&
							!aiStatus.externalAvailable &&
							aiStatus.externalDeniedReason
								? ` - ${aiStatus.externalDeniedReason}`
								: ""}
						</SelectItem>
					</SelectContent>
				</Select>
				{aiStatus?.currentMode === "EXTERNAL" &&
					aiStatus.quotaRemaining !== null && (
						<p className="text-xs text-muted-foreground">
							{t("tokensRemaining", { count: aiStatus.quotaRemaining.toLocaleString() })}
						</p>
					)}
			</div>
		</SettingRow>
	);
}

export function AppPreferencesCard() {
	const t = useTranslations("settings");
	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<CardTitle>{t("preferencesTitle")}</CardTitle>
				<CardDescription>
					{t("preferencesDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<AppPreferencesContent />
			</CardContent>
		</Card>
	);
}
