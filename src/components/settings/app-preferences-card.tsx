"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CurrencyPicker } from "~/components/currency-picker";
import { useThemeContext } from "~/components/theme-provider";
import { Button } from "~/components/ui/button";
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
	fontPreference: z.enum(["sans", "mono"]),
	monthlyIncome: z.string().optional(),
	smartCurrencyFormatting: z.boolean(),
	defaultPrivacyMode: z.boolean(),
});

type AppPreferencesValues = z.infer<typeof appPreferencesSchema>;

export function AppPreferencesCard() {
	const { theme, toggleTheme } = useThemeContext();

	const { data: settings, isLoading: settingsLoading } =
		api.settings.getGeneral.useQuery();

	const updateSettingsMutation = api.settings.updateGeneral.useMutation();

	const form = useForm<AppPreferencesValues>({
		resolver: zodResolver(appPreferencesSchema),
		defaultValues: {
			homeCurrency: "USD",
			defaultCurrency: "USD",
			fontPreference: "sans",
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
				fontPreference:
					(settings.fontPreference as "sans" | "mono") ||
					(localStorage.getItem("fontPreference") as "sans" | "mono") ||
					"sans",
				monthlyIncome: settings.monthlyIncome
					? settings.monthlyIncome.toString()
					: "",
				smartCurrencyFormatting: settings.smartCurrencyFormatting ?? true,
				defaultPrivacyMode: settings.defaultPrivacyMode ?? false,
			});
		}
	}, [settings, form]);

	const fontPreference = form.watch("fontPreference");
	useEffect(() => {
		const root = document.documentElement;
		root.classList.remove("font-sans", "font-mono");
		root.classList.add(`font-${fontPreference}`);
		try {
			localStorage.setItem("fontPreference", fontPreference);
		} catch {
			// ignore storage failures
		}
	}, [fontPreference]);

	const onSubmit = async (values: AppPreferencesValues) => {
		try {
			const monthlyIncomeValue = values.monthlyIncome?.trim()
				? parseFloat(values.monthlyIncome)
				: undefined;

			// We need to pass all required fields to updateGeneral, reusing existing values for others if needed
			// However, ideally the backend allows partial updates. Checking backend definition is out of scope/extra step.
			// Assuming updateGeneral might require other fields or gracefully handle partials if we casts.
			// Let's safe-guard by using `settings` for missing fields if we have to,
			// but best practice is the mutation accepts partials.
			// Checking `generalSettingsSchema` in `general-settings.tsx`, it implied a full object might be needed
			// if it was the same z.object used for validation.
			// Re-reading `general-settings.tsx`, `updateSettingsMutation.mutateAsync` calls with explicit fields.
			// If the backend accepts partials we are good. If not, we need the other values.
			// To be safe, we should probably fetch the other values or include them as hidden fields if strict.
			// BUT, `settings` is available here. So we can merge.

			if (!settings) return;

			await updateSettingsMutation.mutateAsync({
				homeCurrency: values.homeCurrency,
				defaultCurrency: values.defaultCurrency,
				fontPreference: values.fontPreference,
				monthlyIncome: monthlyIncomeValue,
				smartCurrencyFormatting: values.smartCurrencyFormatting,
				defaultPrivacyMode: values.defaultPrivacyMode,
				categoryClickBehavior: settings.categoryClickBehavior || "toggle",
				currencySymbolStyle: settings.currencySymbolStyle || "standard",
			});

			form.reset(values);
			toast.success("App preferences saved!");
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to save settings";
			toast.error(errMsg);
		}
	};

	// Styles for inputs
	const inputClass =
		"bg-secondary/20 border-transparent hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-transparent transition-all";

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
											{/* CurrencyPicker likely uses a Button trigger, we might need to pass className to it if it supports it, 
                                                or wrap it. Looking at usage in general-settings, it just takes props. 
                                                I'll assume I can't easily style the trigger without modifying CurrencyPicker.
                                                However, the user asked to update "Select, Input, and Textarea". CurrencyPicker is a Popover/Command combo typically.
                                                If it uses a Button trigger, I might need to check if it accepts className.
                                            */}
											<div
												className={cn(
													"rounded-md transition-all focus-within:ring-2 focus-within:ring-primary/20",
													inputClass,
												)}
											>
												<CurrencyPicker
													onValueChange={field.onChange}
													placeholder="Select currency"
													value={field.value}
												/>
											</div>
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
											<div
												className={cn(
													"rounded-md transition-all focus-within:ring-2 focus-within:ring-primary/20",
													inputClass,
												)}
											>
												<CurrencyPicker
													onValueChange={field.onChange}
													placeholder="Select currency"
													value={field.value}
												/>
											</div>
										</FormControl>
										<FormDescription>Default for new expenses.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<FormField
								control={form.control}
								name="fontPreference"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Font Preference</FormLabel>
										<Select
											defaultValue={field.value}
											onValueChange={field.onChange}
											value={field.value}
										>
											<FormControl>
												<SelectTrigger className={inputClass}>
													<SelectValue />
												</SelectTrigger>
											</FormControl>
											<SelectContent position="popper">
												<SelectItem value="sans">
													Sans Serif (DM Sans)
												</SelectItem>
												<SelectItem value="mono">
													Monospaced (JetBrains Mono)
												</SelectItem>
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className="space-y-2">
								<FormLabel>Theme Preference</FormLabel>
								<Select
									onValueChange={(value) => {
										if (value !== theme) toggleTheme();
									}}
									value={theme}
								>
									<SelectTrigger className={inputClass}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent position="popper">
										<SelectItem value="light">Light</SelectItem>
										<SelectItem value="dark">Dark</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						<FormField
							control={form.control}
							name="monthlyIncome"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Monthly Net Income</FormLabel>
									<div
										className={cn(
											"flex h-9 w-full items-center gap-2 rounded-md border border-input px-3 py-1 shadow-xs transition-[color,box-shadow]",
											inputClass,
											"border-0", // override default border for the wrapper
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
								<FormItem
									className={cn(
										"flex flex-row items-center justify-between rounded-lg p-4",
										inputClass,
									)}
								>
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
								<FormItem
									className={cn(
										"flex flex-row items-center justify-between rounded-lg p-4",
										inputClass,
									)}
								>
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

						<div className="flex justify-end pt-2">
							<Button
								disabled={
									!form.formState.isDirty || updateSettingsMutation.isPending
								}
								type="submit"
							>
								{updateSettingsMutation.isPending
									? "Saving..."
									: "Save Preferences"}
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
