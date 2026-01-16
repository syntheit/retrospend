"use client";

import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CurrencyPicker } from "~/components/currency-picker";
import { useThemeContext } from "~/components/theme-provider";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
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
import { useSession } from "~/hooks/use-session";
import {
	CATEGORY_COLOR_MAP,
	CATEGORY_COLORS,
	type CategoryColor,
} from "~/lib/constants";
import { cn, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";

export function SettingsForm() {
	const { data: session, isPending: sessionLoading } = useSession();
	const { theme, toggleTheme } = useThemeContext();
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");

	// Settings state
	const [homeCurrency, setHomeCurrency] = useState("USD");
	const [defaultCurrency, setDefaultCurrency] = useState("USD");
	// Default to toggle behavior when no user setting is present
	const [categoryClickBehavior, setCategoryClickBehavior] = useState<
		"navigate" | "toggle"
	>("toggle");
	// Default to sans font when no user setting is present
	const [fontPreference, setFontPreference] = useState<"sans" | "mono">("sans");
	const [fontPreferenceLoaded, setFontPreferenceLoaded] = useState(false);
	// Default to standard symbol style (shows currency code) when no user setting is present
	const [currencySymbolStyle, setCurrencySymbolStyle] = useState<
		"native" | "standard"
	>("standard");
	const [monthlyIncome, setMonthlyIncome] = useState<string>("");

	// Categories state
	const [showCategoryList, setShowCategoryList] = useState(false);
	const [showCategoryDialog, setShowCategoryDialog] = useState(false);
	const [editingCategory, setEditingCategory] = useState<{
		id?: string;
		name: string;
		color: CategoryColor;
	} | null>(null);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<
		string | null
	>(null);
	const [categoryForm, setCategoryForm] = useState({
		name: "",
		color: "blue" as CategoryColor,
	});

	// tRPC hooks
	const { data: settings, isLoading: settingsLoading } =
		api.user.getSettings.useQuery();
	const {
		data: categories,
		isLoading: categoriesLoading,
		refetch: refetchCategories,
	} = api.user.listCategories.useQuery();

	const updateSettingsMutation = api.user.updateSettings.useMutation();
	const createCategoryMutation = api.user.createCategory.useMutation();
	const updateCategoryMutation = api.user.updateCategory.useMutation();
	const deleteCategoryMutation = api.user.deleteCategory.useMutation();
	const exportWealthMutation = api.wealth.exportCsv.useMutation();

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
			setHomeCurrency(settings.homeCurrency);
		}
		if (settings?.categoryClickBehavior) {
			setCategoryClickBehavior(settings.categoryClickBehavior);
		}
		// Always set font preference when settings are available
		if (settings && typeof settings.fontPreference === "string") {
			setFontPreference(settings.fontPreference);
			setFontPreferenceLoaded(true);
		}
		if (settings?.currencySymbolStyle) {
			setCurrencySymbolStyle(settings.currencySymbolStyle);
		}
		if (settings?.monthlyIncome !== undefined) {
			setMonthlyIncome(settings.monthlyIncome?.toString() ?? "");
		}
		// Always apply font when settings load or change
		const fontToApply = settings?.fontPreference ?? "sans";
		applyFontPreference(fontToApply);
		if (settings) {
			setDefaultCurrency(
				settings.defaultCurrency ?? settings.homeCurrency ?? "USD",
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
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save settings");
		}
	};

	const handleAddCategory = () => {
		setEditingCategory(null);
		setCategoryForm({ name: "", color: "blue" });
		setShowCategoryDialog(true);
	};

	const handleEditCategory = (category: {
		id: string;
		name: string;
		color: CategoryColor;
	}) => {
		setEditingCategory(category);
		setCategoryForm({ name: category.name, color: category.color });
		setShowCategoryDialog(true);
	};

	const handleSaveCategory = async () => {
		if (!categoryForm.name.trim()) {
			setError("Category name is required");
			return;
		}

		try {
			if (editingCategory) {
				// Add this check
				if (!editingCategory.id) {
					setError("Category ID is missing");
					return;
				}
				await updateCategoryMutation.mutateAsync({
					id: editingCategory.id,
					name: categoryForm.name.trim(),
					color: categoryForm.color,
				});
			} else {
				await createCategoryMutation.mutateAsync({
					name: categoryForm.name.trim(),
					color: categoryForm.color,
				});
			}
			setShowCategoryDialog(false);
			refetchCategories();
			setError("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save category");
		}
	};

	const handleDeleteCategory = (categoryId: string) => {
		setPendingDeleteCategoryId(categoryId);
		setShowDeleteDialog(true);
	};

	const confirmDeleteCategory = async () => {
		if (!pendingDeleteCategoryId) return;
		try {
			await deleteCategoryMutation.mutateAsync({ id: pendingDeleteCategoryId });
			refetchCategories();
			toast.success("Category deleted");
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to reset categories",
			);
		} finally {
			setShowDeleteDialog(false);
			setPendingDeleteCategoryId(null);
		}
	};

	const handleExportWealth = async () => {
		try {
			const { csv } = await exportWealthMutation.mutateAsync();
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `wealth-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success("Wealth data exported");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export wealth data",
			);
		}
	};

	if (sessionLoading || settingsLoading) {
		return (
			<Card className="mx-auto w-full max-w-4xl">
				<CardContent className="p-6">
					<div className="text-center">Loading...</div>
				</CardContent>
			</Card>
		);
	}

	if (!session?.user) {
		return (
			<Card className="mx-auto w-full max-w-4xl">
				<CardContent className="p-6">
					<div className="text-center">
						Please sign in to access your settings
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			{/* Settings Card */}
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
									<SelectItem value="navigate">
										Navigate to Table View
									</SelectItem>
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
										placeholder={
											fontPreferenceLoaded ? undefined : "Loading..."
										}
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
									<SelectItem value="standard">
										Standard (AR$, CA$, €)
									</SelectItem>
									<SelectItem value="native">Native ($, $, €)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-muted-foreground text-sm">
								Choose how currency symbols are displayed for foreign
								currencies. Standard shows the currency code, native uses local
								symbols.
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
								Choose your preferred color scheme for the application
								interface.
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
								Used to calculate the "Work Equivalent" metric on your
								dashboard.
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
								<Button
									disabled={updateSettingsMutation.isPending}
									type="submit"
								>
									{updateSettingsMutation.isPending
										? "Saving..."
										: "Save Settings"}
								</Button>
							</div>
						</div>
					</form>
				</CardContent>
			</Card>

			{/* Categories Card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Categories</CardTitle>
							<CardDescription>
								Manage your expense categories. Categories help you organize and
								track your spending.
							</CardDescription>
						</div>
						<div className="flex flex-col gap-2 sm:flex-row">
							<Button
								onClick={() => setShowCategoryList(!showCategoryList)}
								size="sm"
								variant="outline"
							>
								{showCategoryList ? (
									<ChevronUp className="mr-2 h-4 w-4" />
								) : (
									<ChevronDown className="mr-2 h-4 w-4" />
								)}
								{showCategoryList ? "Hide" : "Show"} Category List
							</Button>
							<Button onClick={handleAddCategory} size="sm">
								<IconPlus className="mr-2 h-4 w-4" />
								Add Category
							</Button>
						</div>
					</div>
				</CardHeader>
				{showCategoryList && (
					<CardContent>
						{categoriesLoading ? (
							<div className="text-center">Loading categories...</div>
						) : categories?.length === 0 ? (
							<div className="text-center text-muted-foreground">
								No categories yet. Add your first category to get started.
							</div>
						) : categories ? (
							<div className="grid gap-3">
								{categories.map((category) => (
									<div
										className="flex items-center justify-between rounded-lg border p-3"
										key={category.id}
									>
										<div className="flex items-center gap-3">
											<div
												className={cn(
													"h-4 w-4 rounded-full",
													CATEGORY_COLOR_MAP[
														category.color as keyof typeof CATEGORY_COLOR_MAP
													]?.split(" ")[0] || "bg-gray-400",
												)}
											/>
											<span className="font-medium">{category.name}</span>
											<Badge className="text-xs" variant="secondary">
												{category.color}
											</Badge>
										</div>
										<div className="flex gap-2">
											<Button
												onClick={() =>
													handleEditCategory({
														...category,
														color: category.color as CategoryColor,
													})
												}
												size="sm"
												variant="ghost"
											>
												<IconEdit className="h-4 w-4" />
											</Button>
											<Button
												className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
												onClick={() => handleDeleteCategory(category.id)}
												size="sm"
												variant="ghost"
											>
												<IconTrash className="h-4 w-4" />
											</Button>
										</div>
									</div>
								))}
							</div>
						) : null}
					</CardContent>
				)}
			</Card>

			{/* Wealth Export Card */}
			<Card>
				<CardContent className="space-y-6">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-1">
							<p className="font-medium">Export wealth data</p>
							<p className="text-muted-foreground text-sm">
								Downloads all your asset accounts, including balances, types,
								and exchange rates.
							</p>
						</div>
						<Button
							className="w-full sm:w-auto"
							disabled={exportWealthMutation.isPending}
							onClick={handleExportWealth}
							variant="outline"
						>
							{exportWealthMutation.isPending ? "Preparing..." : "Download CSV"}
							<Download className="ml-2 h-4 w-4" />
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Category Dialog */}
			<Dialog onOpenChange={setShowCategoryDialog} open={showCategoryDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{editingCategory ? "Edit Category" : "Add Category"}
						</DialogTitle>
						<DialogDescription>
							{editingCategory
								? "Update the category name and color."
								: "Create a new category to organize your expenses."}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="categoryName">Category Name</Label>
							<Input
								id="categoryName"
								onChange={(e) =>
									setCategoryForm((prev) => ({ ...prev, name: e.target.value }))
								}
								placeholder="e.g., Groceries, Transport, Dining"
								value={categoryForm.name}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="categoryColor">Color</Label>
							<Select
								onValueChange={(value) =>
									setCategoryForm((prev) => ({
										...prev,
										color: value as CategoryColor,
									}))
								}
								value={categoryForm.color}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CATEGORY_COLORS.map((color) => (
										<SelectItem key={color} value={color}>
											<div className="flex items-center gap-2">
												<div
													className={cn(
														"h-3 w-3 rounded-full",
														CATEGORY_COLOR_MAP[color]?.split(" ")[0] ||
															"bg-gray-400",
													)}
												/>
												<span className="capitalize">{color}</span>
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{error && (
							<div className="text-red-600 text-sm dark:text-red-400">
								{error}
							</div>
						)}
					</div>
					<DialogFooter>
						<Button
							disabled={
								createCategoryMutation.isPending ||
								updateCategoryMutation.isPending
							}
							onClick={() => setShowCategoryDialog(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={
								createCategoryMutation.isPending ||
								updateCategoryMutation.isPending
							}
							onClick={handleSaveCategory}
						>
							{createCategoryMutation.isPending ||
							updateCategoryMutation.isPending
								? "Saving..."
								: editingCategory
									? "Update Category"
									: "Add Category"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete category</DialogTitle>
						<DialogDescription>
							This cannot be undone. Expenses using this category will be left
							uncategorized.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteCategoryMutation.isPending}
							onClick={() => {
								setShowDeleteDialog(false);
								setPendingDeleteCategoryId(null);
							}}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteCategoryMutation.isPending}
							onClick={confirmDeleteCategory}
							variant="destructive"
						>
							{deleteCategoryMutation.isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
