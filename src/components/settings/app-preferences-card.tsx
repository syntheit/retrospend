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

// Subset of general settings for this card
const appPreferencesSchema = z.object({
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
});

type AppPreferencesValues = z.infer<typeof appPreferencesSchema>;


export function AppPreferencesCard() {
	const { setTheme, preference: themePreference } = useThemeContext();

	const { data: settings, isLoading: settingsLoading } =
		api.settings.getGeneral.useQuery();

	const updateSettingsMutation = api.settings.updateGeneral.useMutation();

	const form = useForm<AppPreferencesValues>({
		resolver: zodResolver(appPreferencesSchema),
		defaultValues: {
			homeCurrency: "USD",
			defaultCurrency: "USD",
			monthlyIncome: "",
			monthlyIncomeCurrency: "USD" as CurrencyCode,
			smartCurrencyFormatting: true,
			defaultPrivacyMode: false,
			fiscalMonthStartDay: 1,
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
				monthlyIncomeCurrency: (settings.monthlyIncomeCurrency as CurrencyCode) || (settings.homeCurrency as CurrencyCode) || "USD",
				smartCurrencyFormatting: settings.smartCurrencyFormatting ?? true,
				defaultPrivacyMode: settings.defaultPrivacyMode ?? false,
				fiscalMonthStartDay: settings.fiscalMonthStartDay ?? 1,
			});
		}
	}, [settings, form]);

	const utils = api.useUtils();

	const onSubmit = useCallback(
		async (values: AppPreferencesValues) => {
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
					categoryClickBehavior: settings.categoryClickBehavior || "toggle",
					currencySymbolStyle: settings.currencySymbolStyle || "standard",
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
	}, [form]); // form is stable; onSubmit accessed via ref

	// Styles for inputs

	if (settingsLoading) {
		return (
			<Card className="w-full">
				<CardContent className="p-6">
					<div className="text-center text-muted-foreground">
						Loading preferences...
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<CardTitle>App Preferences</CardTitle>
				<CardDescription>
					Customize your visual and regional experience.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<FormField
								control={form.control}
								name="homeCurrency"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Base Currency</FormLabel>
										<FormControl>
											<CurrencyPicker
												onValueChange={(value) => {
													field.onChange(value);
													save();
												}}
												placeholder="Select currency"
												value={field.value}
											/>
										</FormControl>
										<FormDescription>Reporting currency.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="defaultCurrency"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Default Entry Currency</FormLabel>
										<FormControl>
											<CurrencyPicker
												onValueChange={(value) => {
													field.onChange(value);
													save();
												}}
												placeholder="Select currency"
												value={field.value}
											/>
										</FormControl>
										<FormDescription>Default for new expenses.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<FormItem>
								<FormLabel>Theme Preference</FormLabel>
								<Select
									onValueChange={(value) => {
										setTheme(value as "light" | "dark" | "auto");
									}}
									value={themePreference}
								>
									<FormControl>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
									</FormControl>
									<SelectContent position="popper">
										<SelectItem value="light">Light</SelectItem>
										<SelectItem value="dark">Dark</SelectItem>
										<SelectItem value="auto">Auto (Sunrise/Sunset)</SelectItem>
									</SelectContent>
								</Select>
								<FormMessage />
							</FormItem>
						</div>

						<FormField
							control={form.control}
							name="monthlyIncome"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Monthly Net Income</FormLabel>
									<div className={cn(
										"flex h-9 w-full overflow-hidden rounded-md border border-input shadow-xs",
										"transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
										"dark:bg-input/30",
									)}>
										<CurrencyPicker
											value={form.watch("monthlyIncomeCurrency")}
											onValueChange={(value) => {
												form.setValue("monthlyIncomeCurrency", value);
												save();
											}}
											triggerDisplay="flag+code"
											triggerVariant="ghost"
											triggerClassName="h-full rounded-none border-r border-input px-2 shrink-0 focus-visible:ring-0"
										/>
										<FormControl>
											<Input
												className="h-full flex-1 border-0 bg-transparent px-2 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
												placeholder="5000"
												type="number"
												{...field}
												onBlur={() => { field.onBlur(); if (form.formState.isDirty) save(); }}
												onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
											/>
										</FormControl>
									</div>
									<FormDescription>For “Work Equivalent” calculations.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="fiscalMonthStartDay"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Budget Cycle Start Day</FormLabel>
									<FormControl>
										<Input
											className="w-24"
											max={28}
											min={1}
											type="number"
											value={field.value}
											onChange={(e) => {
												const val = parseInt(e.target.value, 10);
												if (!isNaN(val) && val >= 1 && val <= 28) {
													field.onChange(val);
												}
											}}
											onBlur={() => { field.onBlur(); save(); }}
											onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
										/>
									</FormControl>
									<FormDescription>
										Day of the month your budget period begins (1-28).
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="smartCurrencyFormatting"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between space-y-0 py-2">
									<div className="space-y-0.5">
										<FormLabel className="text-base">
											Smart Currency Formatting
										</FormLabel>
										<FormDescription>
											Hide decimals for high-denomination currencies (e.g. JPY).
										</FormDescription>
									</div>
									<FormControl>
										<Switch
											checked={field.value}
											onCheckedChange={(checked) => {
												field.onChange(checked);
												save();
											}}
										/>
									</FormControl>
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="defaultPrivacyMode"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between space-y-0 py-2">
									<div className="space-y-0.5">
										<FormLabel className="text-base">
											Default Privacy Mode
										</FormLabel>
										<FormDescription>
											Hide balances by default when opening the Wealth page.
										</FormDescription>
									</div>
									<FormControl>
										<Switch
											checked={field.value}
											onCheckedChange={(checked) => {
												field.onChange(checked);
												save();
											}}
										/>
									</FormControl>
								</FormItem>
							)}
						/>
					</form>
				</Form>

				<AiProcessingSection />
			</CardContent>
		</Card>
	);
}

function AiProcessingSection() {
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
		<div className="space-y-3 border-t pt-4">
			<div>
				<h3 className="font-medium text-sm">AI Processing</h3>
				<p className="text-muted-foreground text-xs">
					Choose which AI provider processes your bank statement imports.
				</p>
			</div>

			<Select
				disabled={updateSettingsMutation.isPending}
				onValueChange={handleAiModeChange}
				value={settings.aiMode ?? "LOCAL"}
			>
				<SelectTrigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="LOCAL">Local AI (Ollama)</SelectItem>
					<SelectItem
						disabled={!aiStatus?.externalAvailable}
						value="EXTERNAL"
					>
						External AI (OpenRouter)
						{aiStatus && !aiStatus.externalAvailable && aiStatus.externalDeniedReason
							? ` - ${aiStatus.externalDeniedReason}`
							: ""}
					</SelectItem>
				</SelectContent>
			</Select>

			{aiStatus?.currentMode === "EXTERNAL" &&
				aiStatus.quotaRemaining !== null && (
					<p className="text-muted-foreground text-xs">
						{aiStatus.quotaRemaining.toLocaleString()} tokens remaining this
						month
					</p>
				)}
		</div>
	);
}
