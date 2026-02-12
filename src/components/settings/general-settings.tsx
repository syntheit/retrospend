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
import { type CurrencyCode, CURRENCIES } from "~/lib/currencies";
import { cn, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";

const currencyCodeSchema = z.string().refine((val): val is CurrencyCode => val in CURRENCIES, {
	message: "Invalid currency code",
});

const generalSettingsSchema = z.object({
	homeCurrency: currencyCodeSchema,
	defaultCurrency: currencyCodeSchema,
	categoryClickBehavior: z.enum(["navigate", "toggle"]),
	fontPreference: z.enum(["sans", "mono"]),
	currencySymbolStyle: z.enum(["native", "standard"]),
	monthlyIncome: z.string().optional(),
});

type GeneralSettingsValues = z.infer<typeof generalSettingsSchema>;

export function GeneralSettings() {
	const { theme, toggleTheme } = useThemeContext();

	// tRPC hooks
	const { data: settings, isLoading: settingsLoading } =
		api.settings.getGeneral.useQuery();

	const updateSettingsMutation = api.settings.updateGeneral.useMutation();

	const form = useForm<GeneralSettingsValues>({
		resolver: zodResolver(generalSettingsSchema),
		defaultValues: {
			homeCurrency: "USD",
			defaultCurrency: "USD",
			categoryClickBehavior: "toggle",
			fontPreference: "sans",
			currencySymbolStyle: "standard",
			monthlyIncome: "",
		},
	});

	// Apply font preference when it changes
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

	// Initialize form when settings load
	useEffect(() => {
		if (settings) {
			form.reset({
				homeCurrency: (settings.homeCurrency as CurrencyCode) || "USD",
				defaultCurrency:
					(settings.defaultCurrency as CurrencyCode) ||
					(settings.homeCurrency as CurrencyCode) ||
					"USD",
				categoryClickBehavior: settings.categoryClickBehavior || "toggle",
				fontPreference:
					(settings.fontPreference as "sans" | "mono") ||
					(localStorage.getItem("fontPreference") as "sans" | "mono") ||
					"sans",
				currencySymbolStyle: settings.currencySymbolStyle || "standard",
				monthlyIncome: settings.monthlyIncome
					? settings.monthlyIncome.toString()
					: "",
			});
		}
	}, [settings, form]);

	const onSubmit = async (values: GeneralSettingsValues) => {
		try {
			const monthlyIncomeValue = values.monthlyIncome?.trim()
				? parseFloat(values.monthlyIncome)
				: undefined;

			await updateSettingsMutation.mutateAsync({
				homeCurrency: values.homeCurrency,
				defaultCurrency: values.defaultCurrency,
				categoryClickBehavior: values.categoryClickBehavior,
				fontPreference: values.fontPreference,
				currencySymbolStyle: values.currencySymbolStyle,
				monthlyIncome: monthlyIncomeValue,
			});
			// Reset dirty state with new values
			form.reset(values);
			toast.success("Settings saved successfully!");
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to save settings";
			toast.error(errMsg);
		}
	};

	if (settingsLoading) {
		return (
			<Card className="mx-auto w-full max-w-4xl">
				<CardContent className="p-6">
					<div className="text-center">Loading...</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>General Settings</CardTitle>
				<CardDescription>
					Configure your default preferences for the application.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
												value={field.value}
												placeholder="Select currency"
											/>
										</FormControl>
										<FormDescription>
											The currency your expenses will be converted to.
										</FormDescription>
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
												value={field.value}
												placeholder="Select currency"
											/>
										</FormControl>
										<FormDescription>
											The currency selected when you open the 'Add Expense'
											modal.
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<FormField
							control={form.control}
							name="categoryClickBehavior"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Category Click Behavior</FormLabel>
									<Select
										onValueChange={field.onChange}
										defaultValue={field.value}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
										</FormControl>
										<SelectContent position="popper">
											<SelectItem value="navigate">
												Navigate to Table View
											</SelectItem>
											<SelectItem value="toggle">
												Toggle Category Visibility
											</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										Choose what happens when you click on categories in the
										overview donut chart.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="fontPreference"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Font Preference</FormLabel>
									<Select
										onValueChange={field.onChange}
										defaultValue={field.value}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
										</FormControl>
										<SelectContent position="popper">
											<SelectItem value="sans">Sans Serif (DM Sans)</SelectItem>
											<SelectItem value="mono">
												Monospaced (JetBrains Mono)
											</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										Choose your preferred font style for the application
										interface.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="currencySymbolStyle"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Currency Symbol Style</FormLabel>
									<Select
										onValueChange={field.onChange}
										defaultValue={field.value}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
										</FormControl>
										<SelectContent position="popper">
											<SelectItem value="standard">
												Standard (AR$, CA$, €)
											</SelectItem>
											<SelectItem value="native">Native ($, $, €)</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										Choose how currency symbols are displayed for foreign
										currencies. Standard shows the currency code, native uses
										local symbols.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="space-y-2">
							<FormLabel>Theme Preference</FormLabel>
							<Select
								value={theme}
								onValueChange={(value) => {
									if (value !== theme) toggleTheme();
								}}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent position="popper">
									<SelectItem value="light">Light</SelectItem>
									<SelectItem value="dark">Dark</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-[0.8rem] text-muted-foreground">
								Choose your preferred color scheme for the application
								interface.
							</p>
						</div>

						<FormField
							control={form.control}
							name="monthlyIncome"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Monthly Net Income</FormLabel>
									<div
										className={cn(
											"flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
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
										Used to calculate the "Work Equivalent" metric on your
										dashboard.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="border-stone-800 border-t pt-6">
							<div className="flex justify-end">
								<Button
									disabled={
										!form.formState.isDirty || updateSettingsMutation.isPending
									}
									type="submit"
								>
									{updateSettingsMutation.isPending
										? "Saving..."
										: "Save Settings"}
								</Button>
							</div>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
