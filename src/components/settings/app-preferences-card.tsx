"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CurrencyPicker } from "~/components/currency-picker";
import { useThemeContext } from "~/components/theme-provider";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Form, FormControl, FormField } from "~/components/ui/form";
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
}: {
	value: string;
	onChange: (v: "light" | "dark" | "auto") => void;
}) {
	return (
		<Tabs value={value} onValueChange={(v) => onChange(v as "light" | "dark" | "auto")}>
			<TabsList>
				<TabsTrigger value="light">Light</TabsTrigger>
				<TabsTrigger value="dark">Dark</TabsTrigger>
				<TabsTrigger value="auto">System</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}

export function AppPreferencesContent() {
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
				toast.success("Preferences updated");
			} catch (err) {
				const errMsg =
					err instanceof Error ? err.message : "Failed to save settings";
				toast.error(errMsg);
			}
		},
		[settings, updateSettingsMutation, form, utils],
	);

	const onSubmitRef = useRef(onSubmit);
	onSubmitRef.current = onSubmit;

	const save = useCallback(() => {
		void form.handleSubmit(onSubmitRef.current)();
	}, [form]);

	if (settingsLoading) {
		return (
			<div className="py-4 text-center text-muted-foreground">
				Loading preferences...
			</div>
		);
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)}>
				{/* Regional */}
				<SectionHeader>Regional</SectionHeader>
				<div className="divide-y divide-border/40">
					<FormField
						control={form.control}
						name="homeCurrency"
						render={({ field }) => (
							<SettingRow
								label="Base Currency"
								description="Reporting currency"
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
								label="Default Entry Currency"
								description="Default for new expenses"
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
								label="Currency Symbol Style"
								description="Display format for foreign currencies"
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
											Standard (AR$, CA$, €)
										</SelectItem>
										<SelectItem value="native">Native ($, $, €)</SelectItem>
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
								label="Smart Currency Formatting"
								description="Hide decimals for high-denomination currencies"
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
				<SectionHeader>Budget & income</SectionHeader>
				<div className="divide-y divide-border/40">
					<FormField
						control={form.control}
						name="monthlyIncome"
						render={({ field }) => (
							<SettingRow
								label="Monthly Net Income"
								description="For Work Equivalent calculations"
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
								label="Budget Cycle Start Day"
								description="Day of month your budget period begins"
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
				<SectionHeader>Display</SectionHeader>
				<div className="divide-y divide-border/40">
					<SettingRow label="Theme" description="App color scheme">
						<ThemeToggle
							onChange={(v) => setTheme(v)}
							value={themePreference}
						/>
					</SettingRow>

					<FormField
						control={form.control}
						name="defaultPrivacyMode"
						render={({ field }) => (
							<SettingRow
								label="Default Privacy Mode"
								description="Hide balances when opening the Wealth page"
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
				<SectionHeader>Behavior</SectionHeader>
				<div className="divide-y divide-border/40">
					<FormField
						control={form.control}
						name="defaultExpenseDateBehavior"
						render={({ field }) => (
							<SettingRow
								label="Default Expense Date"
								description="Pre-filled when creating a new expense"
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
										<SelectItem value="TODAY">Today</SelectItem>
										<SelectItem value="LAST_USED">Last Used Date</SelectItem>
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
								label="Category Click Behavior"
								description="Action when clicking a category on charts"
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
											Navigate to Transactions
										</SelectItem>
										<SelectItem value="toggle">
											Toggle Category Visibility
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

function AiProcessingRow() {
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
			toast.success("AI mode updated");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to update AI mode",
			);
		}
	};

	return (
		<SettingRow
			label="AI Processing"
			description="Provider for bank statement imports"
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
						<SelectItem value="LOCAL">Local AI (Ollama)</SelectItem>
						<SelectItem
							disabled={!aiStatus?.externalAvailable}
							value="EXTERNAL"
						>
							External AI (OpenRouter)
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
							{aiStatus.quotaRemaining.toLocaleString()} tokens remaining this
							month
						</p>
					)}
			</div>
		</SettingRow>
	);
}

export function AppPreferencesCard() {
	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<CardTitle>App Preferences</CardTitle>
				<CardDescription>
					Customize your visual and regional experience.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<AppPreferencesContent />
			</CardContent>
		</Card>
	);
}
