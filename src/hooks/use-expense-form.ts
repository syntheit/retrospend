"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { SplitParticipant } from "~/components/split-with-picker";
import { useCurrencyConversion } from "~/hooks/use-currency-conversion";
import { useSession } from "~/hooks/use-session";
import { useSettings } from "~/hooks/use-settings";
import { predictCategory } from "~/lib/category-matcher";
import { BASE_CURRENCY } from "~/lib/constants";
import { CRYPTO_CURRENCIES, CURRENCIES } from "~/lib/currencies";

import { api } from "~/trpc/react";

export const expenseSchema = z.object({
	title: z.string().optional(),
	amount: z.number({ invalid_type_error: "Amount is required" }).positive("Amount must be positive"),
	currency: z
		.string()
		.refine(
			(val) => val in CURRENCIES || val in CRYPTO_CURRENCIES,
			"Please select a valid currency",
		),
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
	excludeFromAnalytics: z.boolean().optional(),
});

export type ExpenseFormData = z.infer<typeof expenseSchema>;

export type ExpenseInitialValues = {
	title?: string | null;
	amount: number;
	currency: string;
	exchangeRate?: number | null;
	amountInUSD?: number | null;
	pricingSource?: string;
	categoryId?: string | null;
	description?: string | null;
	location?: string | null;
};

interface UseExpenseFormOptions {
	expenseId?: string;
	sharedTransactionId?: string;
	mode?: "create" | "edit";
	isModal?: boolean;
	onClose?: () => void;
	onSaveAndNew?: () => void;
	onTitleChange?: (title: string) => void;
	projectId?: string;
	projectDefaultCurrency?: string;
	isSolo?: boolean;
	initialValues?: ExpenseInitialValues;
	stickyDefaults?: { currency?: string };
	/** Override the current-user identity (used for guest participants). */
	currentParticipant?: {
		participantType: "user" | "guest" | "shadow";
		participantId: string;
		name?: string;
	};
}

export function useExpenseForm({
	expenseId,
	sharedTransactionId,
	mode = "edit",
	isModal,
	onClose,
	onSaveAndNew,
	onTitleChange,
	projectId,
	projectDefaultCurrency,
	isSolo: _isSolo,
	initialValues,
	stickyDefaults,
	currentParticipant,
}: UseExpenseFormOptions) {
	const router = useRouter();
	const utils = api.useUtils();
	const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
	const hasUnsavedChangesRef = useRef(false);
	// true while the category was set by auto-prediction (not by the user)
	const categoryAutoPredictedRef = useRef(false);
	const [pendingNavigation, setPendingNavigation] = useState<string | null>(
		null,
	);
	const [isCustomRateSet, setIsCustomRateSet] = useState(false);
	// true when excludeFromAnalytics was auto-set by category default (not manually toggled)
	const [excludeAutoNote, setExcludeAutoNote] = useState(false);
	// true once the user explicitly clicks the exclude switch
	const excludeInteractedRef = useRef(false);
	// tracks "Save & Add Another" intent for the current submission
	const saveAndNewRef = useRef(false);

	// Shared expense state
	const [splitWith, setSplitWith] = useState<SplitParticipant[]>([]);
	const [splitMode, setSplitMode] = useState<
		"EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES"
	>("EQUAL");
	const [paidBy, setPaidBy] = useState<{
		participantType: string;
		participantId: string;
	}>({ participantType: "user", participantId: "" });
	const [exactAmounts, setExactAmounts] = useState<Record<string, number>>({});
	const [percentages, setPercentages] = useState<Record<string, number>>({});
	const [shares, setShares] = useState<Record<string, number>>({});
	const [theyOweFullAmount, setTheyOweFullAmount] = useState(false);
	// Guest participants from a shared transaction being edited (picker doesn't support guests)
	const [guestParticipantsFromTx, setGuestParticipantsFromTx] = useState<
		Array<{ participantType: "guest"; participantId: string }>
	>([]);

	// Project selector state
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
	const [autoPopulateProjectId, setAutoPopulateProjectId] = useState<string | null>(
		!sharedTransactionId && projectId ? projectId : null
	);

	const { data: session } = useSession();
	const { data: avatarData } = api.profile.getMyAvatar.useQuery();

	// Resolved participant identity: explicit override takes precedence over session
	const resolvedParticipant = currentParticipant ?? {
		participantType: "user" as const,
		participantId: session?.user?.id ?? "",
	};
	const currentUser = {
		id: resolvedParticipant.participantId,
		name: currentParticipant?.name ?? session?.user?.name ?? "You",
		avatarUrl: avatarData?.avatarUrl ?? session?.user?.image ?? null,
	};

	// Initialize paidBy to current participant when identity resolves
	useEffect(() => {
		if (resolvedParticipant.participantId && paidBy.participantId === "") {
			setPaidBy(resolvedParticipant);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resolvedParticipant.participantId, paidBy.participantId]);

	const isSharedExpense = splitWith.length > 0;

	const handleExactAmountChange = useCallback((key: string, amount: number) => {
		setExactAmounts((prev) => ({ ...prev, [key]: amount }));
	}, []);

	const handlePercentageChange = useCallback((key: string, pct: number) => {
		setPercentages((prev) => ({ ...prev, [key]: pct }));
	}, []);

	const handleSharesChange = useCallback((key: string, units: number) => {
		setShares((prev) => ({ ...prev, [key]: Math.max(1, Math.floor(units)) }));
	}, []);

	const handleSplitModeChange = useCallback(
		(
			mode: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES",
			computedAmounts?: Record<string, number>,
		) => {
			if (mode === "PERCENTAGE") {
				// Set equal percentages for all participants
				const allParticipants = [
					resolvedParticipant,
					...splitWith.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
					})),
				].filter((p) => p.participantId);
				const count = allParticipants.length;
				if (count > 0) {
					const base = Math.floor(10000 / count) / 100;
					const remainder = parseFloat((100 - base * count).toFixed(2));
					const newPercentages: Record<string, number> = {};
					allParticipants.forEach((p, i) => {
						const key = `${p.participantType}:${p.participantId}`;
						newPercentages[key] =
							i === count - 1
								? parseFloat((base + remainder).toFixed(2))
								: base;
					});
					setPercentages(newPercentages);
				}
			} else if (mode === "SHARES") {
				// Set 1 share each
				const allParticipants = [
					resolvedParticipant,
					...splitWith.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
					})),
				].filter((p) => p.participantId);
				const newShares: Record<string, number> = {};
				allParticipants.forEach((p) => {
					newShares[`${p.participantType}:${p.participantId}`] = 1;
				});
				setShares(newShares);
			} else if (mode === "EXACT" && computedAmounts) {
				setExactAmounts(computedAmounts);
			} else if (mode === "EQUAL") {
				setTheyOweFullAmount(false);
			}
			setSplitMode(mode);
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[splitWith, resolvedParticipant.participantId],
	);

	const handleProjectChange = useCallback((newProjectId: string | null) => {
		setSelectedProjectId(newProjectId);
		// Reset split state
		setSplitWith([]);
		setSplitMode("EQUAL");
		setExactAmounts({});
		setPercentages({});
		setShares({});
		setTheyOweFullAmount(false);
	}, []);

	const { data: expense, isLoading: isLoadingExpense } =
		api.expense.getExpense.useQuery(
			{ id: expenseId ?? "" },
			{ enabled: mode === "edit" && Boolean(expenseId) && !sharedTransactionId },
		);

	const { data: settings } = useSettings();
	const { data: categories } = api.categories.getAll.useQuery();

	const defaultExpenseCurrency =
		projectDefaultCurrency ?? stickyDefaults?.currency ?? settings?.defaultCurrency ?? settings?.homeCurrency ?? BASE_CURRENCY;
	const homeCurrency = settings?.homeCurrency || BASE_CURRENCY;

	// Project queries for the selector
	const { data: userProjects } = api.project.list.useQuery(
		{ status: "ACTIVE" },
		{ enabled: !currentParticipant && (mode === "create" || Boolean(sharedTransactionId)) },
	);

	const { data: selectedProjectDetail } = api.project.detail.useQuery(
		{ id: selectedProjectId ?? "" },
		{ enabled: !!selectedProjectId && !currentParticipant },
	);

	const selectableProjects = useMemo(() => {
		if (!userProjects) return [];
		return userProjects.filter((p) => p.myRole !== "VIEWER");
	}, [userProjects]);

	const isSelectedSoloProject = useMemo(() => {
		if (!selectedProjectId) return false;
		if (_isSolo !== undefined && selectedProjectId === projectId) return _isSolo;
		const project = userProjects?.find((p) => p.id === selectedProjectId);
		if (project) return project._count.participants <= 1;
		return false;
	}, [selectedProjectId, projectId, _isSolo, userProjects]);

	const getDefaultDate = () => {
		if (settings?.defaultExpenseDateBehavior === "LAST_USED") {
			try {
				const stored = localStorage.getItem("retrospend:lastExpenseDate");
				if (stored) {
					const parsed = new Date(stored);
					if (!Number.isNaN(parsed.getTime())) return parsed;
				}
			} catch {
				// localStorage unavailable
			}
		}
		return new Date();
	};

	const form = useForm<ExpenseFormData>({
		resolver: zodResolver(expenseSchema),
		defaultValues: {
			title: "",
			amount: "" as unknown as number,
			currency: defaultExpenseCurrency,
			exchangeRate: undefined,
			amountInUSD: undefined,
			date: getDefaultDate(),
			location: "",
			description: "",
			categoryId: "",
			spreadOverTime: false,
			amortizeOver: 3,
			excludeFromAnalytics: false,
		},
	});

	const {
		reset,
		watch,
		setValue,
		formState: { isDirty, dirtyFields },
	} = form;

	const watchedAmount = watch("amount");
	const watchedExchangeRate = watch("exchangeRate");
	const watchedTitle = watch("title");
	const watchedCurrency = watch("currency");

	const watchedDate = watch("date");

	// Duplicate detection (create mode only)
	const duplicateCheckInput = useMemo(() => {
		if (mode !== "create" || !watchedTitle || !watchedAmount || !watchedDate) return null;
		return { title: watchedTitle, amount: watchedAmount, date: watchedDate };
	}, [mode, watchedTitle, watchedAmount, watchedDate]);

	const [debouncedDupInput, setDebouncedDupInput] = useState<typeof duplicateCheckInput>(null);

	useEffect(() => {
		if (!duplicateCheckInput) {
			setDebouncedDupInput(null);
			return;
		}
		const timer = setTimeout(() => setDebouncedDupInput(duplicateCheckInput), 800);
		return () => clearTimeout(timer);
	}, [duplicateCheckInput]);

	const { data: duplicateCheck } = api.expense.checkDuplicate.useQuery(
		debouncedDupInput!,
		{ enabled: !!debouncedDupInput },
	);

	// Title suggestions for auto-category and amount hint (create mode only)
	const [debouncedTitle, setDebouncedTitle] = useState("");

	useEffect(() => {
		if (!watchedTitle || watchedTitle.length < 2 || mode !== "create") {
			setDebouncedTitle("");
			return;
		}
		const timer = setTimeout(() => setDebouncedTitle(watchedTitle), 300);
		return () => clearTimeout(timer);
	}, [watchedTitle, mode]);

	const { data: titleSuggestionsData } = api.expense.titleSuggestions.useQuery(
		{ query: debouncedTitle },
		{ enabled: mode === "create" && debouncedTitle.length >= 2 },
	);

	const [categoryAutoSuggested, setCategoryAutoSuggested] = useState(false);
	const [amountHint, setAmountHint] = useState<{ amount: number; currency: string } | null>(null);

	useEffect(() => {
		if (!titleSuggestionsData || !debouncedTitle) {
			setAmountHint(null);
			return;
		}

		const match = titleSuggestionsData.find(
			(s) => s.title.toLowerCase() === debouncedTitle.toLowerCase(),
		);

		if (!match || match.count < 2) {
			setAmountHint(null);
			return;
		}

		// Auto-set category from user history (overrides local keyword matching)
		if (match.lastCategoryId && categories) {
			const currentCatId = form.getValues("categoryId");
			const canAutoSet = !currentCatId || categoryAutoPredictedRef.current;
			if (canAutoSet) {
				const cat = categories.find((c) => c.id === match.lastCategoryId);
				if (cat && currentCatId !== match.lastCategoryId) {
					categoryAutoPredictedRef.current = true;
					setValue("categoryId", match.lastCategoryId, { shouldDirty: true });
					// Auto-set excludeFromAnalytics based on category default
					if (!excludeInteractedRef.current) {
						const shouldExclude = cat.excludeByDefault ?? false;
						setValue("excludeFromAnalytics", shouldExclude, { shouldDirty: true });
						setExcludeAutoNote(shouldExclude);
					}
					setCategoryAutoSuggested(true);
					setTimeout(() => setCategoryAutoSuggested(false), 1500);
				}
			}
		}

		// Set amount/currency hint
		if (match.lastAmount != null && match.lastCurrency) {
			setAmountHint({ amount: match.lastAmount, currency: match.lastCurrency });
		} else {
			setAmountHint(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [titleSuggestionsData, debouncedTitle]);

	// Currency conversion hook
	const { toUSD } = useCurrencyConversion();

	// Mutations
	const invalidateExpenseRelated = () =>
		void Promise.all([
			utils.expense.listFinalized.invalidate(),
			utils.dashboard.getOverviewStats.invalidate(),
			utils.dashboard.getOverviewData.invalidate(),
			utils.budget.getBudgets.invalidate(),
			// getOverviewData already covers stats refresh; avoid blanket stats invalidation
		]);

	const createExpenseMutation = api.expense.createExpense.useMutation({
		onSuccess: invalidateExpenseRelated,
	});

	const updateExpenseMutation = api.expense.updateExpense.useMutation({
		onSuccess: () => {
			invalidateExpenseRelated();
			if (expenseId) utils.expense.getExpense.invalidate({ id: expenseId });
		},
	});

	const deleteExpenseMutation = api.expense.deleteExpense.useMutation({
		onSuccess: () => {
			invalidateExpenseRelated();
			if (expenseId) utils.expense.getExpense.invalidate({ id: expenseId });
		},
	});

	const createSharedTransactionMutation =
		api.sharedTransaction.create.useMutation({
			onSuccess: () => {
				invalidateExpenseRelated();
				utils.people.list.invalidate();
			},
		});

	const isSharedTransactionEdit = mode === "edit" && Boolean(sharedTransactionId);

	const { data: sharedTx, isLoading: isLoadingSharedTx } =
		api.sharedTransaction.getById.useQuery(
			{ id: sharedTransactionId ?? "" },
			{ enabled: isSharedTransactionEdit },
		);

	const updateSharedTransactionMutation = api.sharedTransaction.update.useMutation({
		onSuccess: () => {
			void utils.people.list.invalidate();
			void utils.verification.queue.invalidate();
			if (sharedTransactionId) {
				void utils.sharedTransaction.getById.invalidate({ id: sharedTransactionId });
			}
		},
	});

	// Event Handlers
	const handleTitleChange = (title: string) => {
		// Block prediction only if the user manually selected a category
		if ((dirtyFields.categoryId && !categoryAutoPredictedRef.current) || !categories || !title) return;

		const predictedCategoryName = predictCategory(title);
		if (!predictedCategoryName) return;

		const matchingCategory = categories.find(
			(cat) => cat.name.toLowerCase() === predictedCategoryName.toLowerCase(),
		);

		if (matchingCategory) {
			categoryAutoPredictedRef.current = true;
			setValue("categoryId", matchingCategory.id, { shouldDirty: true });
		}
	};

	const handleCategoryChange = (value: string) => {
		categoryAutoPredictedRef.current = false;
		setValue("categoryId", value, { shouldDirty: true });
		// Auto-set excludeFromAnalytics based on category's default (only if user hasn't manually toggled)
		if (!excludeInteractedRef.current) {
			const cat = categories?.find((c) => c.id === value);
			const shouldExclude = cat?.excludeByDefault ?? false;
			setValue("excludeFromAnalytics", shouldExclude, { shouldDirty: true });
			setExcludeAutoNote(shouldExclude);
		}
	};

	const handleExcludeToggle = (checked: boolean) => {
		excludeInteractedRef.current = true;
		setValue("excludeFromAnalytics", checked, { shouldDirty: true });
		setExcludeAutoNote(false);
	};

	const handleAmountChange = (value: number) => {
		const usdValue = toUSD(value, watchedCurrency, watchedExchangeRate);
		setValue("amountInUSD", usdValue, { shouldDirty: true });
	};

	const handleCurrencyChange = (currency: string) => {
		setValue("currency", currency, { shouldDirty: true });

		if (currency === homeCurrency) {
			setValue("exchangeRate", 1, { shouldDirty: true });
			setValue("pricingSource", "official", { shouldDirty: true });
			setValue("amountInUSD", watchedAmount || 0, { shouldDirty: true });
			setIsCustomRateSet(false);
			return;
		}

		// Let RateSelector auto-determine the default rate.
		// By clearing the exchange rate and type, we prompt RateSelector
		// to fetch rates and auto-select based on history and favorites.
		setValue("exchangeRate", undefined, { shouldDirty: true });
		setValue("pricingSource", undefined, { shouldDirty: true });
		setValue("amountInUSD", undefined, { shouldDirty: true });
		setIsCustomRateSet(false);
	};

	const handleExchangeRateChange = (
		rate: number | undefined,
		type?: string,
		shouldDirty = true,
	) => {
		setValue("exchangeRate", rate, { shouldDirty });
		if (type) {
			setValue("pricingSource", type, { shouldDirty });
		}
		const usdValue = toUSD(watchedAmount, watchedCurrency, rate);
		setValue("amountInUSD", usdValue, { shouldDirty });
	};

	// Manage navigation guard ref manually
	useEffect(() => {
		const isEffectiveDirty =
			isDirty &&
			(mode === "edit" || !!watchedTitle || (watchedAmount || 0) > 0);
		hasUnsavedChangesRef.current = isEffectiveDirty;
	}, [isDirty, mode, watchedTitle, watchedAmount]);

	// Pre-fill from shared transaction when editing
	useEffect(() => {
		if (!sharedTx || !isSharedTransactionEdit || !currentUser.id) return;

		reset({
			title: sharedTx.description,
			amount: sharedTx.amount,
			currency: sharedTx.currency,
			date: new Date(sharedTx.date),
			categoryId: sharedTx.category?.id ?? "",
			description: sharedTx.notes ?? "",
			location: "",
			spreadOverTime: false,
			amortizeOver: 3,
		});
		onTitleChange?.(sharedTx.description);

		setPaidBy({
			participantType: sharedTx.paidBy.participantType,
			participantId: sharedTx.paidBy.participantId,
		});

		setSplitMode(sharedTx.splitMode as "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES");

		const others = sharedTx.splitParticipants.filter(
			(sp) => !(sp.participantType === resolvedParticipant.participantType && sp.participantId === resolvedParticipant.participantId),
		);

		const guests: Array<{ participantType: "guest"; participantId: string }> = [];
		const nonGuests: SplitParticipant[] = [];
		for (const sp of others) {
			if (sp.participantType === "guest") {
				guests.push({ participantType: "guest", participantId: sp.participantId });
			} else {
				nonGuests.push({
					participantType: sp.participantType as "user" | "shadow",
					participantId: sp.participantId,
					name: sp.name,
					email: null,
				});
			}
		}
		setSplitWith(nonGuests);
		setGuestParticipantsFromTx(guests);

		if (sharedTx.splitMode === "EXACT") {
			const amounts: Record<string, number> = {};
			for (const sp of sharedTx.splitParticipants) {
				amounts[`${sp.participantType}:${sp.participantId}`] = sp.shareAmount ?? 0;
			}
			setExactAmounts(amounts);
		} else if (sharedTx.splitMode === "PERCENTAGE") {
			const pcts: Record<string, number> = {};
			for (const sp of sharedTx.splitParticipants) {
				pcts[`${sp.participantType}:${sp.participantId}`] = sp.sharePercentage ?? 0;
			}
			setPercentages(pcts);
		} else if (sharedTx.splitMode === "SHARES") {
			const sh: Record<string, number> = {};
			for (const sp of sharedTx.splitParticipants) {
				sh[`${sp.participantType}:${sp.participantId}`] = sp.shareUnits ?? 1;
			}
			setShares(sh);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sharedTx?.id, currentUser.id]);

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
				excludeFromAnalytics: expense.excludeFromAnalytics || false,
			});
			onTitleChange?.(expense.title || "");
			categoryAutoPredictedRef.current = false;
			// Treat existing excluded expenses as user-set (suppress the "auto-excluded" note)
			if (expense.excludeFromAnalytics) {
				excludeInteractedRef.current = true;
			}
		}
	}, [expense, reset, onTitleChange]);

	// Apply initial values for duplicate mode
	const initialValuesApplied = useRef(false);
	useEffect(() => {
		if (initialValues && mode === "create" && !initialValuesApplied.current) {
			initialValuesApplied.current = true;
			reset({
				title: initialValues.title ?? "",
				amount: initialValues.amount,
				currency: initialValues.currency,
				exchangeRate: initialValues.exchangeRate ?? undefined,
				amountInUSD: initialValues.amountInUSD ?? undefined,
				pricingSource: initialValues.pricingSource,
				date: getDefaultDate(),
				location: initialValues.location ?? "",
				description: initialValues.description ?? "",
				categoryId: initialValues.categoryId ?? "",
				spreadOverTime: false,
				amortizeOver: 3,
				excludeFromAnalytics: false,
			});
			onTitleChange?.(initialValues.title ?? "");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialValues, mode]);

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

	// Initialize selectedProjectId from shared transaction data when editing (once)
	const sharedTxProjectInitRef = useRef(false);
	useEffect(() => {
		if (isSharedTransactionEdit && sharedTx?.projectId && !sharedTxProjectInitRef.current) {
			sharedTxProjectInitRef.current = true;
			setSelectedProjectId(sharedTx.projectId);
		}
	}, [isSharedTransactionEdit, sharedTx?.projectId]);

	// Auto-populate participants from project detail when a project is selected
	useEffect(() => {
		if (!autoPopulateProjectId || !selectedProjectDetail || selectedProjectDetail.id !== autoPopulateProjectId || !currentUser.id) return;
		setAutoPopulateProjectId(null);

		const otherParticipants: SplitParticipant[] = selectedProjectDetail.participants
			.filter((p) =>
				(p.participantType === "user" || p.participantType === "shadow") &&
				!(p.participantType === "user" && p.participantId === currentUser.id)
			)
			.map((p) => ({
				participantType: p.participantType as "user" | "shadow",
				participantId: p.participantId,
				name: p.name,
				email: p.email ?? null,
				username: p.username ?? null,
				avatarUrl: p.avatarUrl ?? null,
			}));

		setSplitWith(otherParticipants);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoPopulateProjectId, selectedProjectDetail, currentUser.id]);

	const onSubmit = async (data: ExpenseFormData) => {
		try {
			if (isSharedTransactionEdit && sharedTransactionId) {
				// --- Shared transaction update path ---
				const allParticipants = [
					resolvedParticipant,
					...splitWith.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
					})),
					...guestParticipantsFromTx,
				];

				type SplitInput = {
					participantType: "user" | "guest" | "shadow";
					participantId: string;
					shareAmount?: number;
					sharePercentage?: number;
					shareUnits?: number;
				};
				let splitWithInput: SplitInput[];

				if (splitMode === "EXACT") {
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
						shareAmount:
							exactAmounts[`${p.participantType}:${p.participantId}`] ?? 0,
					}));
				} else if (splitMode === "PERCENTAGE") {
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
						sharePercentage:
							percentages[`${p.participantType}:${p.participantId}`] ??
							100 / allParticipants.length,
					}));
				} else if (splitMode === "SHARES") {
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
						shareUnits: shares[`${p.participantType}:${p.participantId}`] ?? 1,
					}));
				} else if (splitWith.length === 1 && theyOweFullAmount) {
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
						shareAmount: p.participantId === resolvedParticipant.participantId ? 0 : data.amount,
					}));
				} else {
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
					}));
				}

				const effectiveSplitMode =
					theyOweFullAmount && splitWith.length === 1
						? ("EXACT" as const)
						: splitMode;

				await updateSharedTransactionMutation.mutateAsync({
					id: sharedTransactionId,
					amount: data.amount,
					currency: data.currency,
					description: data.title || "Untitled expense",
					categoryId: data.categoryId || null,
					date: data.date,
					notes: data.description || null,
					paidBy: {
						participantType: paidBy.participantType as "user" | "guest" | "shadow",
						participantId: paidBy.participantId,
					},
					splitWith: splitWithInput,
					splitMode: effectiveSplitMode,
					projectId: selectedProjectId,
				});

				// Invalidate both old and new project caches
				if (sharedTx?.projectId) {
					void utils.project.listExpenses.invalidate({ projectId: sharedTx.projectId });
					void utils.project.detail.invalidate({ id: sharedTx.projectId });
				}
				if (selectedProjectId && selectedProjectId !== sharedTx?.projectId) {
					void utils.project.listExpenses.invalidate({ projectId: selectedProjectId });
					void utils.project.detail.invalidate({ id: selectedProjectId });
				}

				toast.success("Expense updated!");
			} else if (isSharedExpense || selectedProjectId) {
				// --- Shared expense create path ---
				const allParticipants = [
					resolvedParticipant,
					...splitWith.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
					})),
				];

				let splitWithInput: Array<{
					participantType: "user" | "guest" | "shadow";
					participantId: string;
					shareAmount?: number;
					sharePercentage?: number;
					shareUnits?: number;
				}>;

				if (splitMode === "EXACT") {
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
						shareAmount:
							exactAmounts[`${p.participantType}:${p.participantId}`] ?? 0,
					}));
				} else if (splitMode === "PERCENTAGE") {
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
						sharePercentage:
							percentages[`${p.participantType}:${p.participantId}`] ??
							100 / allParticipants.length,
					}));
				} else if (splitMode === "SHARES") {
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
						shareUnits: shares[`${p.participantType}:${p.participantId}`] ?? 1,
					}));
				} else if (splitWith.length === 1 && theyOweFullAmount) {
					// "They owe full amount": current user gets 0, other gets all
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
						shareAmount: p.participantId === resolvedParticipant.participantId ? 0 : data.amount,
					}));
				} else {
					// Equal split: let the server compute
					splitWithInput = allParticipants.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
					}));
				}

				// When "they owe full amount" is active, we send EXACT with
				// explicit per-person amounts (0 for us, full for them)
				const effectiveSplitMode =
					theyOweFullAmount && splitWith.length === 1
						? ("EXACT" as const)
						: splitMode;

				await createSharedTransactionMutation.mutateAsync({
					amount: data.amount,
					currency: data.currency,
					description: data.title || "Untitled expense",
					categoryId: data.categoryId || undefined,
					date: data.date,
					paidBy: {
						participantType: paidBy.participantType as
							| "user"
							| "guest"
							| "shadow",
						participantId: paidBy.participantId,
					},
					splitWith: splitWithInput,
					splitMode: effectiveSplitMode,
					projectId: selectedProjectId ?? undefined,
				});

				if (selectedProjectId) {
					void utils.project.listExpenses.invalidate({ projectId: selectedProjectId });
					void utils.project.detail.invalidate({ id: selectedProjectId });
				}

				if (!saveAndNewRef.current) toast.success("Shared expense created!");
			} else {
				// --- Personal expense path ---
				const submitData = {
					...data,
					title: data.title || "",
					exchangeRate: data.exchangeRate || undefined,
					amountInUSD: data.amountInUSD || undefined,
					description: data.description || undefined,
					amortizeOver: data.spreadOverTime ? data.amortizeOver : undefined,
					excludeFromAnalytics: data.excludeFromAnalytics ?? false,
				};

				if (expenseId && expense) {
					await updateExpenseMutation.mutateAsync({
						id: expenseId,
						...submitData,
					});
					if (!saveAndNewRef.current) toast.success("Changes saved!");
				} else {
					await createExpenseMutation.mutateAsync({
						id: expenseId ?? "",
						...submitData,
					});
					if (!saveAndNewRef.current) {
						toast.success(
							data.spreadOverTime
								? `Expense split over ${data.amortizeOver} months`
								: "Expense saved successfully!",
						);
					}
				}
			}

			// Persist date for "last used" behavior
			try {
				localStorage.setItem(
					"retrospend:lastExpenseDate",
					data.date.toISOString(),
				);
			} catch {
				// localStorage unavailable
			}

			// In event-driven world, reset(data) marks as clean with current values
			reset(data);
			hasUnsavedChangesRef.current = false;

			// Reset shared expense state
			setSplitWith([]);
			setSplitMode("EQUAL");
			setExactAmounts({});
			setPercentages({});
			setShares({});
			setTheyOweFullAmount(false);

			if (saveAndNewRef.current) {
				saveAndNewRef.current = false;
				toast.success("Saved — ready for next");
				onSaveAndNew?.();
				return;
			}

			if (isModal) {
				onClose?.();
			} else {
				router.push("/dashboard");
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
			router.push("/dashboard");
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
		handleTitleChange,
		handleCategoryChange,
		handleExcludeToggle,
		excludeAutoNote,
		handleDelete,
		handleUndoChanges,
		handleDiscardChanges,
		isLoading: isLoadingExpense || isLoadingSharedTx,
		isSubmitting:
			createExpenseMutation.isPending ||
			updateExpenseMutation.isPending ||
			createSharedTransactionMutation.isPending ||
			updateSharedTransactionMutation.isPending,
		isDeleting: deleteExpenseMutation.isPending,
		isSharedTransactionEdit,
		hasVerifiedParticipants: sharedTx?.hasVerifiedParticipants ?? false,
		sharedTxProjectId: sharedTx?.projectId ?? null,
		sharedTxProjectName: sharedTx?.projectName ?? null,
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
		// Save & Add Another
		saveAndNewRef,
		// Duplicate detection
		duplicateWarning: duplicateCheck?.isDuplicate ?? false,
		// Title suggestions
		categoryAutoSuggested,
		amountHint,
		// Shared expense state
		splitWith,
		setSplitWith,
		splitMode,
		handleSplitModeChange,
		paidBy,
		setPaidBy,
		exactAmounts,
		handleExactAmountChange,
		percentages,
		handlePercentageChange,
		shares,
		handleSharesChange,
		theyOweFullAmount,
		setTheyOweFullAmount,
		isSharedExpense,
		currentUser,
		// Project selector
		selectedProjectId,
		handleProjectChange,
		selectableProjects,
		isSelectedSoloProject,
	};
}
