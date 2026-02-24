"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useSettings } from "~/hooks/use-settings";
import { predictCategory } from "~/lib/category-matcher";
import { BASE_CURRENCY } from "~/lib/constants";
import { CURRENCIES } from "~/lib/currencies";
import { api } from "~/trpc/react";

export const expenseSchema = z.object({
	title: z.string().optional(),
	amount: z.number().positive("Amount must be positive"),
	currency: z
		.string()
		.refine((val) => val in CURRENCIES, "Please select a valid currency"),
	exchangeRate: z
		.number()
		.positive("Exchange rate must be positive")
		.optional(),
	amountInUSD: z.number().positive("Amount in USD must be positive").optional(),
	pricingSource: z.string().optional(),
	date: z.date(),
	location: z.string().optional(),
	description: z.string().optional(),
	categoryId: z.string().min(1, "Please select a category"),
	spreadOverTime: z.boolean().optional(),
	amortizeOver: z.number().int().min(2).max(24).optional(),
});

export type ExpenseFormData = z.infer<typeof expenseSchema>;

interface UseExpenseFormOptions {
	expenseId?: string;
	mode?: "create" | "edit";
	isModal?: boolean;
	onClose?: () => void;
	onTitleChange?: (title: string) => void;
}

export function useExpenseForm({
	expenseId,
	mode = "edit",
	isModal,
	onClose,
	onTitleChange,
}: UseExpenseFormOptions) {
	const router = useRouter();
	const utils = api.useUtils();
	const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
	const hasUnsavedChangesRef = useRef(false);
	const [pendingNavigation, setPendingNavigation] = useState<string | null>(
		null,
	);
	const [isCustomRateSet, setIsCustomRateSet] = useState(false);

	const { data: expense, isLoading: isLoadingExpense } =
		api.expense.getExpense.useQuery(
			{ id: expenseId ?? "" },
			{ enabled: mode === "edit" && Boolean(expenseId) },
		);

	const { data: settings } = useSettings();
	const { data: categories } = api.categories.getAll.useQuery();

	const defaultExpenseCurrency =
		settings?.defaultCurrency ?? settings?.homeCurrency ?? BASE_CURRENCY;
	const homeCurrency = settings?.homeCurrency || BASE_CURRENCY;

	const form = useForm<ExpenseFormData>({
		resolver: zodResolver(expenseSchema),
		defaultValues: {
			title: "",
			amount: 0,
			currency: defaultExpenseCurrency,
			exchangeRate: undefined,
			amountInUSD: undefined,
			date: new Date(),
			location: "",
			description: "",
			categoryId: "",
			spreadOverTime: false,
			amortizeOver: 3,
		},
	});

	const {
		reset,
		watch,
		setValue,
		formState: { isDirty, dirtyFields },
	} = form;

	const watchedCurrency = watch("currency");
	const watchedAmount = watch("amount");
	const watchedExchangeRate = watch("exchangeRate");
	const watchedTitle = watch("title");

	// Mutations
	const createExpenseMutation = api.expense.createExpense.useMutation({
		onSuccess: () => {
			utils.expense.listFinalized.invalidate();
			utils.dashboard.getOverviewStats.invalidate();
			utils.budget.getBudgets.invalidate();
			utils.stats.invalidate();
		},
	});

	const updateExpenseMutation = api.expense.updateExpense.useMutation({
		onSuccess: () => {
			utils.expense.listFinalized.invalidate();
			if (expenseId) utils.expense.getExpense.invalidate({ id: expenseId });
			utils.dashboard.getOverviewStats.invalidate();
			utils.budget.getBudgets.invalidate();
			utils.stats.invalidate();
		},
	});

	const deleteExpenseMutation = api.expense.deleteExpense.useMutation({
		onSuccess: () => {
			utils.expense.listFinalized.invalidate();
			if (expenseId) utils.expense.getExpense.invalidate({ id: expenseId });
			utils.dashboard.getOverviewStats.invalidate();
			utils.budget.getBudgets.invalidate();
			utils.stats.invalidate();
		},
	});

	// Helper for currency conversion
	const calculateAmountInUSD = (
		amount: number | undefined,
		currency: string,
		rate: number | undefined,
	): number => {
		if (currency === homeCurrency) return amount ?? 0;
		if (amount && amount > 0 && rate && rate > 0) {
			const calculatedAmount = amount / rate;
			return Math.round(calculatedAmount * 100) / 100;
		}
		return 0;
	};

	// Event Handlers
	const handleTitleBlur = () => {
		if (dirtyFields.categoryId || !categories || !watchedTitle) return;

		const predictedCategoryName = predictCategory(watchedTitle);
		if (!predictedCategoryName) return;

		const matchingCategory = categories.find(
			(cat) => cat.name.toLowerCase() === predictedCategoryName.toLowerCase(),
		);

		if (matchingCategory) {
			setValue("categoryId", matchingCategory.id, { shouldDirty: true });
		}
	};

	const handleAmountChange = (value: number) => {
		const usd = calculateAmountInUSD(
			value,
			watchedCurrency,
			watchedExchangeRate,
		);
		setValue("amountInUSD", usd, { shouldDirty: true });
	};

	const handleCurrencyChange = (currency: string) => {
		setValue("currency", currency, { shouldDirty: true });
		// Reset rate if currency changes away from home
		const newRate = currency === homeCurrency ? 1 : undefined;
		if (currency === homeCurrency) {
			setValue("exchangeRate", 1, { shouldDirty: true });
		}
		const usd = calculateAmountInUSD(watchedAmount, currency, newRate);
		setValue("amountInUSD", usd, { shouldDirty: true });
	};

	const handleExchangeRateChange = (rate: number | undefined) => {
		setValue("exchangeRate", rate, { shouldDirty: true });
		const usd = calculateAmountInUSD(watchedAmount, watchedCurrency, rate);
		setValue("amountInUSD", usd, { shouldDirty: true });
	};

	// Manage navigation guard ref manually
	useEffect(() => {
		const isEffectiveDirty =
			isDirty &&
			(mode === "edit" || !!watchedTitle || (watchedAmount || 0) > 0);
		hasUnsavedChangesRef.current = isEffectiveDirty;
	}, [isDirty, mode, watchedTitle, watchedAmount]);

	// Load existing expense data
	useEffect(() => {
		if (expense) {
			reset({
				title: expense.title || "",
				amount: Number(expense.amount),
				currency: expense.currency,
				exchangeRate: expense.exchangeRate
					? Number(expense.exchangeRate)
					: undefined,
				amountInUSD: expense.amountInUSD
					? Number(expense.amountInUSD)
					: undefined,
				date: new Date(expense.date),
				location: expense.location || "",
				description: expense.description || "",
				categoryId: expense.categoryId || "",
				spreadOverTime: expense.isAmortizedParent || false,
				amortizeOver: expense.children?.length || 3,
			});
			onTitleChange?.(expense.title || "");
		}
	}, [expense, reset, onTitleChange]);

	// Navigation Guards
	useEffect(() => {
		if (isModal) return;

		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (isDirty) {
				e.preventDefault();
				e.returnValue = "";
			}
		};

		const handleAnchorClick = (event: MouseEvent) => {
			if (!isDirty) return;
			const target = event.target as HTMLElement | null;
			const anchor = target?.closest<HTMLAnchorElement>("a[href]");
			if (!anchor || anchor.target === "_blank") return;

			const href = anchor.getAttribute("href");
			if (
				!href ||
				href.startsWith("#") ||
				href.startsWith("mailto:") ||
				href.startsWith("tel:")
			)
				return;

			const url = new URL(href, window.location.href);
			if (url.href === window.location.href) return;

			event.preventDefault();
			setPendingNavigation(url.pathname + url.search + url.hash);
			setShowUnsavedDialog(true);
		};

		const handlePopState = (event: PopStateEvent) => {
			if (!isDirty) return;
			event.preventDefault();
			history.pushState(null, "", window.location.href);
			setPendingNavigation("back");
			setShowUnsavedDialog(true);
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		window.addEventListener("click", handleAnchorClick);
		window.addEventListener("popstate", handlePopState);

		return () => {
			window.removeEventListener("beforeunload", handleBeforeUnload);
			window.removeEventListener("click", handleAnchorClick);
			window.removeEventListener("popstate", handlePopState);
		};
	}, [isDirty, isModal]);

	const onSubmit = async (data: ExpenseFormData) => {
		try {
			const submitData = {
				...data,
				title: data.title || "",
				exchangeRate: data.exchangeRate || undefined,
				amountInUSD: data.amountInUSD || undefined,
				description: data.description || undefined,
				amortizeOver: data.spreadOverTime ? data.amortizeOver : undefined,
			};

			if (expenseId && expense) {
				await updateExpenseMutation.mutateAsync({
					id: expenseId,
					...submitData,
				});
				toast.success("Changes saved!");
			} else {
				await createExpenseMutation.mutateAsync({
					id: expenseId ?? "",
					...submitData,
				});
				toast.success(
					data.spreadOverTime
						? `Expense split over ${data.amortizeOver} months`
						: "Expense saved successfully!",
				);
			}

			// In event-driven world, reset(data) marks as clean with current values
			reset(data);
			hasUnsavedChangesRef.current = false;

			if (isModal) {
				onClose?.();
			} else {
				router.push("/app");
			}
		} catch (_error) {
			toast.error("Failed to save expense");
		}
	};

	const handleDelete = async () => {
		if (!expenseId) return;
		try {
			await deleteExpenseMutation.mutateAsync({ id: expenseId });
			toast.success("Expense deleted successfully!");
			hasUnsavedChangesRef.current = false;
			router.push("/app");
		} catch (_error) {
			toast.error("Failed to delete expense");
		}
	};

	const handleDiscardChanges = () => {
		setShowUnsavedDialog(false);
		reset();
		hasUnsavedChangesRef.current = false;
		if (pendingNavigation) {
			if (pendingNavigation === "back") router.back();
			else if (pendingNavigation === "close") onClose?.();
			else router.push(pendingNavigation);
		}
	};

	const handleUndoChanges = () => {
		if (expense) {
			reset({
				title: expense.title || "",
				amount: Number(expense.amount),
				currency: expense.currency,
				exchangeRate: expense.exchangeRate
					? Number(expense.exchangeRate)
					: undefined,
				amountInUSD: expense.amountInUSD
					? Number(expense.amountInUSD)
					: undefined,
				date: new Date(expense.date),
				location: expense.location || "",
				description: expense.description || "",
				categoryId: expense.categoryId || "",
				spreadOverTime: expense.isAmortizedParent || false,
				amortizeOver: expense.children?.length || 3,
			});
			toast.info("Changes reverted");
		}
	};

	return {
		form,
		onSubmit,
		handleAmountChange,
		handleCurrencyChange,
		handleExchangeRateChange,
		handleTitleBlur,
		handleDelete,
		handleUndoChanges,
		handleDiscardChanges,
		isLoading: isLoadingExpense,
		isSubmitting:
			createExpenseMutation.isPending || updateExpenseMutation.isPending,
		isDeleting: deleteExpenseMutation.isPending,
		hasUnsavedChanges:
			isDirty &&
			(mode === "edit" || !!watch("title") || (watch("amount") || 0) > 0),
		hasUnsavedChangesRef,
		showUnsavedDialog,
		setShowUnsavedDialog,
		setPendingNavigation,
		isCustomRateSet,
		setIsCustomRateSet,
		settings,
		categories,
		homeCurrency,
		expense,
	};
}
