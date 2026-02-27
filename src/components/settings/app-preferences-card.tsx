"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect } from "react";
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
import { CURRENCIES, type CurrencyCode } from "~/lib/currencies";
import { cn, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";

const currencyCodeSchema = z
	.string()
	.refine((val): val is CurrencyCode => val in CURRENCIES, {
		message: "Invalid currency code",
	});

// Subset of general settings for this card
const appPreferencesSchema = z.object({
	homeCurrency: currencyCodeSchema,
	defaultCurrency: currencyCodeSchema,
	monthlyIncome: z.string().optional(),
	smartCurrencyFormatting: z.boolean(),
	defaultPrivacyMode: z.boolean(),
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
			smartCurrencyFormatting: true,
			defaultPrivacyMode: false,
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
				smartCurrencyFormatting: settings.smartCurrencyFormatting ?? true,
				defaultPrivacyMode: settings.defaultPrivacyMode ?? false,
			});
		}
	}, [settings, form]);

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
					smartCurrencyFormatting: values.smartCurrencyFormatting,
					defaultPrivacyMode: values.defaultPrivacyMode,
					categoryClickBehavior: settings.categoryClickBehavior || "toggle",
					currencySymbolStyle: settings.currencySymbolStyle || "standard",
				});

				form.reset(values);
			} catch (err) {
				const errMsg =
					err instanceof Error ? err.message : "Failed to save settings";
				toast.error(errMsg);
			}
		},
		[settings, updateSettingsMutation, form],
	);

	useEffect(() => {
		let timeoutId: NodeJS.Timeout;
		const subscription = form.watch(() => {
			if (form.formState.isDirty) {
				if (timeoutId) clearTimeout(timeoutId);
				timeoutId = setTimeout(() => {
					void form.handleSubmit(onSubmit)();
				}, 1000);
			}
		});
		return () => {
			subscription.unsubscribe();
			if (timeoutId) clearTimeout(timeoutId);
		};
	}, [form, onSubmit]);

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
												onValueChange={field.onChange}
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
												onValueChange={field.onChange}
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
									<div
										className={cn(
											"flex h-9 w-full items-center gap-2 rounded-md border border-input px-3 py-1 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
											"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
										)}
									>
										<span className="shrink-0 font-medium text-muted-foreground">
											{getCurrencySymbol(form.watch("homeCurrency"))}
										</span>
										<FormControl>
											<Input
												className="h-full w-full border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
												placeholder="5000"
												type="number"
												{...field}
											/>
										</FormControl>
									</div>
									<FormDescription>
										For "Work Equivalent" calculations.
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
											onCheckedChange={field.onChange}
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
											onCheckedChange={field.onChange}
										/>
									</FormControl>
								</FormItem>
							)}
						/>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
