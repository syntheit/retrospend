"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import type { CurrencyCode } from "~/lib/currencies";
import { cn, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";

export function GeneralSettings() {
	const { theme, toggleTheme } = useThemeContext();
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");

	// Settings state
	const [homeCurrency, setHomeCurrency] = useState<CurrencyCode>("USD");
	const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>("USD");
	const [categoryClickBehavior, setCategoryClickBehavior] = useState<
		"navigate" | "toggle"
	>("toggle");
	const [fontPreference, setFontPreference] = useState<"sans" | "mono">("sans");
	const [fontPreferenceLoaded, setFontPreferenceLoaded] = useState(false);
	const [currencySymbolStyle, setCurrencySymbolStyle] = useState<
		"native" | "standard"
	>("standard");
	const [monthlyIncome, setMonthlyIncome] = useState<string>("");

	// tRPC hooks
	const { data: settings, isLoading: settingsLoading } =
		api.settings.getGeneral.useQuery();

	const updateSettingsMutation = api.settings.updateGeneral.useMutation();

	const applyFontPreference = useCallback((font: "sans" | "mono") => {
		const root = document.documentElement;
		root.classList.remove("font-sans", "font-mono");
		root.classList.add(`font-${font}`);
		try {
			localStorage.setItem("fontPreference", font);
		} catch {
			// ignore storage failures; class already applied
		}
	}, []);

	// Populate settings when loaded
	useEffect(() => {
		if (settings?.homeCurrency) {
			setHomeCurrency(settings.homeCurrency as CurrencyCode);
		}
		if (settings?.categoryClickBehavior) {
			setCategoryClickBehavior(settings.categoryClickBehavior);
		}
		if (settings && typeof settings.fontPreference === "string") {
			setFontPreference(settings.fontPreference as "sans" | "mono");
			setFontPreferenceLoaded(true);
		}
		if (settings?.currencySymbolStyle) {
			setCurrencySymbolStyle(settings.currencySymbolStyle);
		}
		if (settings?.monthlyIncome !== undefined) {
			setMonthlyIncome(settings.monthlyIncome?.toString() ?? "");
		}
		// Always apply font when settings load or change
		const fontToApply = (settings?.fontPreference as "sans" | "mono") ?? "sans";
		applyFontPreference(fontToApply);
		if (settings) {
			setDefaultCurrency(
				(settings.defaultCurrency ??
					settings.homeCurrency ??
					"USD") as CurrencyCode,
			);
		}
	}, [settings, applyFontPreference]);

	const handleSaveSettings = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setSuccess("");

		try {
			const monthlyIncomeValue = monthlyIncome.trim()
				? parseFloat(monthlyIncome)
				: undefined;
			await updateSettingsMutation.mutateAsync({
				homeCurrency,
				defaultCurrency,
				categoryClickBehavior,
				fontPreference,
				currencySymbolStyle,
				monthlyIncome: monthlyIncomeValue,
			});
			setSuccess("Settings saved successfully!");
			toast.success("Settings saved successfully!");
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to save settings";
			setError(errMsg);
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
				<form className="space-y-4" onSubmit={handleSaveSettings}>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="homeCurrency">Base Currency</Label>
							<CurrencyPicker
								onValueChange={setHomeCurrency}
								placeholder="Select currency"
								value={homeCurrency}
							/>
							<p className="text-muted-foreground text-sm">
								The currency your expenses will be converted to.
							</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="defaultCurrency">Default Entry Currency</Label>
							<CurrencyPicker
								onValueChange={setDefaultCurrency}
								placeholder="Select currency"
								value={defaultCurrency}
							/>
							<p className="text-muted-foreground text-sm">
								The currency selected when you open the 'Add Expense' modal.
							</p>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="categoryClickBehavior">
							Category Click Behavior
						</Label>
						<Select
							onValueChange={(value) =>
								setCategoryClickBehavior(value as "navigate" | "toggle")
							}
							value={categoryClickBehavior}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								<SelectItem value="navigate">Navigate to Table View</SelectItem>
								<SelectItem value="toggle">
									Toggle Category Visibility
								</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-sm">
							Choose what happens when you click on categories in the overview
							donut chart.
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="fontPreference">Font Preference</Label>
						<Select
							disabled={!fontPreferenceLoaded}
							onValueChange={(value) => {
								const newFont = value as "sans" | "mono";
								setFontPreference(newFont);
								// Apply font immediately for preview
								applyFontPreference(newFont);
							}}
							value={fontPreference}
						>
							<SelectTrigger>
								<SelectValue
									placeholder={fontPreferenceLoaded ? undefined : "Loading..."}
								/>
							</SelectTrigger>
							<SelectContent position="popper">
								<SelectItem value="sans">Sans Serif (DM Sans)</SelectItem>
								<SelectItem value="mono">
									Monospaced (JetBrains Mono)
								</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-sm">
							Choose your preferred font style for the application interface.
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="currencySymbolStyle">Currency Symbol Style</Label>
						<Select
							onValueChange={(value) =>
								setCurrencySymbolStyle(value as "native" | "standard")
							}
							value={currencySymbolStyle}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								<SelectItem value="standard">Standard (AR$, CA$, €)</SelectItem>
								<SelectItem value="native">Native ($, $, €)</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-sm">
							Choose how currency symbols are displayed for foreign currencies.
							Standard shows the currency code, native uses local symbols.
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="themePreference">Theme Preference</Label>
						<Select
							onValueChange={(value) => {
								// If the selected value doesn't match current theme, toggle it
								if (value !== theme) {
									toggleTheme();
								}
							}}
							value={theme}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								<SelectItem value="light">Light</SelectItem>
								<SelectItem value="dark">Dark</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-sm">
							Choose your preferred color scheme for the application interface.
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="monthlyIncome">Monthly Net Income</Label>
						<div
							className={cn(
								"flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
								"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
							)}
						>
							<span className="shrink-0 font-medium text-muted-foreground">
								{getCurrencySymbol(homeCurrency)}
							</span>
							<Input
								className="h-full w-full border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
								id="monthlyIncome"
								onChange={(e) => setMonthlyIncome(e.target.value)}
								placeholder="5000"
								type="number"
								value={monthlyIncome}
							/>
						</div>
						<p className="text-muted-foreground text-sm">
							Used to calculate the "Work Equivalent" metric on your dashboard.
						</p>
					</div>
					{error && (
						<div className="text-red-600 text-sm dark:text-red-400">
							{error}
						</div>
					)}
					{success && (
						<div className="text-green-600 text-sm dark:text-green-400">
							{success}
						</div>
					)}
					<div className="border-stone-800 border-t pt-6">
						<div className="flex justify-end">
							<Button disabled={updateSettingsMutation.isPending} type="submit">
								{updateSettingsMutation.isPending
									? "Saving..."
									: "Save Settings"}
							</Button>
						</div>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
