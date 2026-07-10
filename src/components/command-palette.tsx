"use client";

import {
	CirclePlus,
	Coins,
	FileInput,
	Folder,
	Keyboard,
	LayoutDashboard,
	MessageCircle,
	PiggyBank,
	Receipt,
	Repeat,
	Settings,
	Users,
	Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { useRecurringModal } from "~/components/recurring-modal-provider";
import { FeedbackModal } from "~/components/feedback-modal";
import { ProjectVisual } from "~/components/project/project-visual";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "~/components/ui/command";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { CURRENCIES, CRYPTO_CURRENCIES } from "~/lib/currencies";
import { formatCurrency, isCrypto } from "~/lib/currency-format";
import { getRateTypeLabel } from "~/lib/exchange-rates-shared";
import { formatExpenseDate } from "~/lib/format";
import { api } from "~/trpc/react";

type CommandAction = {
	id: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	shortcut?: string;
	subtitle?: string;
	onSelect: () => void;
};

export function CommandPalette() {
	const t = useTranslations("commands");
	const ts = useTranslations("sidebar");
	const tn = useTranslations("nav");
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const router = useRouter();
	const { openNewExpense, openExpense } = useExpenseModal();
	const { openNewRecurring } = useRecurringModal();

	// All currencies merged (stable reference)
	const allCurrencies = useMemo(
		() => ({ ...CURRENCIES, ...CRYPTO_CURRENCIES }),
		[],
	);

	// Detect currency code match from search input
	const matchedCurrency = useMemo(() => {
		const trimmed = search.trim().toUpperCase();
		if (trimmed.length < 3) return null;
		return allCurrencies[trimmed as keyof typeof allCurrencies] ?? null;
	}, [search, allCurrencies]);

	// Custom filter: boost currency items to top, standard substring for the rest
	const commandFilter = useCallback(
		(value: string, search: string): number => {
			const code = search.trim().toUpperCase();
			if (
				code.length >= 3 &&
				code in allCurrencies &&
				value.toLowerCase().startsWith(code.toLowerCase())
			) {
				return 2;
			}
			return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
		},
		[allCurrencies],
	);

	// Fetch rates for matched currency
	const { data: currencyRates } =
		api.exchangeRate.getRatesForCurrency.useQuery(
			{ currency: matchedCurrency?.code ?? "" },
			{ enabled: !!matchedCurrency },
		);

	// Fetch recent expenses when palette is open
	const { data: recentExpenses } = api.expense.listFinalized.useQuery(
		undefined,
		{ enabled: open },
	);

	// Fetch projects when palette is open
	const { data: projects } = api.project.list.useQuery(
		{},
		{ enabled: open },
	);

	// Global keyboard shortcuts
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			// Cmd+K — toggle command palette
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((prev) => !prev);
			}

			// Single-key shortcuts (only when no input focused)
			if (!e.metaKey && !e.ctrlKey && !e.altKey) {
				const active = document.activeElement;
				const tag = active?.tagName.toLowerCase();
				if (
					tag === "input" ||
					tag === "textarea" ||
					tag === "select" ||
					(active as HTMLElement)?.isContentEditable
				) {
					return;
				}

				// N — new expense
				if (e.key === "n" || e.key === "N") {
					e.preventDefault();
					openNewExpense();
				}

				// ? — keyboard shortcuts
				if (e.key === "?") {
					e.preventDefault();
					setShortcutsOpen((prev) => !prev);
				}
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [openNewExpense]);

	const close = useCallback(() => {
		setOpen(false);
		setSearch("");
	}, []);

	const navigate = useCallback(
		(path: string) => {
			close();
			router.push(path);
		},
		[router, close],
	);

	const recent = (recentExpenses ?? [])
		.slice(0, 5)
		.map((e) => ({
			id: e.id,
			label: e.title,
			icon: Receipt,
			subtitle: `${formatCurrency(Number(e.amount), e.currency)} · ${formatExpenseDate(new Date(e.date))}`,
			onSelect: () => {
				close();
				openExpense(e.id);
			},
		}));

	const pages: CommandAction[] = [
		{
			id: "dashboard",
			label: ts("dashboard"),
			icon: LayoutDashboard,
			onSelect: () => navigate("/dashboard"),
		},
		{
			id: "transactions",
			label: ts("transactions"),
			icon: Receipt,
			onSelect: () => navigate("/transactions"),
		},
		{
			id: "budget",
			label: ts("budget"),
			icon: PiggyBank,
			onSelect: () => navigate("/budget"),
		},
		{
			id: "recurring",
			label: ts("recurring"),
			icon: Repeat,
			onSelect: () => navigate("/recurring"),
		},
		{
			id: "people",
			label: ts("people"),
			icon: Users,
			onSelect: () => navigate("/people"),
		},
		{
			id: "projects",
			label: ts("projects"),
			icon: Folder,
			onSelect: () => navigate("/projects"),
		},
		{
			id: "import",
			label: ts("import"),
			icon: FileInput,
			onSelect: () => navigate("/import"),
		},
		{
			id: "wealth",
			label: ts("wealth"),
			icon: Wallet,
			onSelect: () => navigate("/wealth"),
		},
		{
			id: "currencies",
			label: ts("currencies"),
			icon: Coins,
			onSelect: () => navigate("/currencies"),
		},
		{
			id: "settings",
			label: tn("settings"),
			icon: Settings,
			onSelect: () => navigate("/settings"),
		},
	];

	const actions: CommandAction[] = [
		{
			id: "add-expense",
			label: t("addExpense"),
			icon: CirclePlus,
			onSelect: () => {
				close();
				openNewExpense();
			},
		},
		{
			id: "add-recurring",
			label: t("addRecurring"),
			icon: Repeat,
			onSelect: () => {
				close();
				openNewRecurring();
			},
		},
		{
			id: "send-feedback",
			label: t("sendFeedback"),
			icon: MessageCircle,
			onSelect: () => {
				close();
				setFeedbackOpen(true);
			},
		},
		{
			id: "keyboard-shortcuts",
			label: t("keyboardShortcuts"),
			icon: Keyboard,
			shortcut: "?",
			onSelect: () => {
				close();
				setShortcutsOpen(true);
			},
		},
	];

	return (
		<>
			<CommandDialog
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) setSearch("");
				}}
				title={t("title")}
				description={t("description")}
				showCloseButton={false}
				filter={commandFilter}
				loop
			>
				<CommandInput
					placeholder={t("placeholder")}
					onValueChange={setSearch}
				/>
				<CommandList>
					<CommandEmpty>{t("noResults")}</CommandEmpty>
					{matchedCurrency && (
						<CommandGroup heading={t("currency")}>
							<CommandItem
								value={`${matchedCurrency.code} ${matchedCurrency.name} currency`}
								onSelect={() => {
									const tab = isCrypto(matchedCurrency.code)
										? "crypto"
										: "fiat";
									navigate(
										`/currencies?tab=${tab}&currency=${matchedCurrency.code}`,
									);
								}}
								className="!py-3"
							>
								<div className="flex items-center gap-3 w-full">
									<CurrencyFlag
										currencyCode={matchedCurrency.code}
										className="!h-10 !w-10"
									/>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-semibold">
												{matchedCurrency.code}
											</span>
											<span className="text-muted-foreground text-sm">
												{matchedCurrency.name}
											</span>
										</div>
										<div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
											<span>
												{t("symbol")} {matchedCurrency.symbol_native}
											</span>
											{currencyRates && currencyRates.length > 0 ? (
												currencyRates.map((r) => (
													<span
														key={r.type}
														className="tabular-nums"
													>
														{getRateTypeLabel(r.type)}:{" "}
														{Number(r.rate).toLocaleString(
															undefined,
															{
																minimumFractionDigits: 2,
																maximumFractionDigits: 4,
															},
														)}
													</span>
												))
											) : (
												<span className="italic">
													{t("noRateData")}
												</span>
											)}
										</div>
									</div>
									<span className="text-muted-foreground text-xs shrink-0">
										{t("viewRates")}
									</span>
								</div>
							</CommandItem>
						</CommandGroup>
					)}
					{recent.length > 0 && (
						<CommandGroup heading={t("recentExpenses")}>
							{recent.map((item) => (
								<CommandItem
									key={item.id}
									onSelect={item.onSelect}
									value={`${item.label} ${item.subtitle}`}
								>
									<item.icon className="size-4" />
									<span className="truncate">{item.label}</span>
									<span className="ml-auto text-muted-foreground text-xs">
										{item.subtitle}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					)}
					{projects && projects.length > 0 && (
						<CommandGroup heading={t("projects")}>
							{projects.map((project) => (
								<CommandItem
									key={project.id}
									value={`project ${project.name}`}
									onSelect={() => navigate(`/projects/${project.id}`)}
								>
									<ProjectVisual
										imagePath={project.imagePath ?? null}
										projectName={project.name}
										size="xs"
									/>
									<span className="truncate">{project.name}</span>
								</CommandItem>
							))}
						</CommandGroup>
					)}
					<CommandGroup heading={t("pages")}>
						{pages.map((item) => (
							<CommandItem
								key={item.id}
								onSelect={item.onSelect}
								value={item.label}
							>
								<item.icon className="size-4" />
								<span>{item.label}</span>
								{item.shortcut && (
									<CommandShortcut>{item.shortcut}</CommandShortcut>
								)}
							</CommandItem>
						))}
					</CommandGroup>
					<CommandGroup heading={t("actions")}>
						{actions.map((item) => (
							<CommandItem
								key={item.id}
								onSelect={item.onSelect}
								value={item.label}
							>
								<item.icon className="size-4" />
								<span>{item.label}</span>
								{item.shortcut && (
									<CommandShortcut>{item.shortcut}</CommandShortcut>
								)}
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</CommandDialog>

			<KeyboardShortcutsDialog
				open={shortcutsOpen}
				onOpenChange={setShortcutsOpen}
			/>

			<FeedbackModal
				open={feedbackOpen}
				onOpenChange={setFeedbackOpen}
			/>
		</>
	);
}

// ── Keyboard Shortcuts Dialog ────────────────────────────────────────

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";

type ShortcutEntry = { keys: string[]; description: string };
type ShortcutGroup = { title: string; shortcuts: ShortcutEntry[] };

function useModifierKey() {
	const [isMac, setIsMac] = useState(false);

	useEffect(() => {
		setIsMac(navigator.platform?.toUpperCase().includes("MAC") ?? false);
	}, []);

	return isMac ? "\u2318" : "Ctrl";
}

function KeyboardShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const mod = useModifierKey();
	const t = useTranslations("commands");

	const groups: ShortcutGroup[] = [
		{
			title: t("global"),
			shortcuts: [
				{ keys: [`${mod}+K`], description: t("openPalette") },
				{ keys: ["N"], description: t("newExpense") },
				{ keys: ["/"], description: t("focusSearch") },
				{ keys: ["?"], description: t("showShortcuts") },
				{ keys: [`${mod}+B`], description: t("toggleSidebar") },
			],
		},
		{
			title: t("table"),
			shortcuts: [
				{ keys: [`${mod}+A`], description: t("selectAllRows") },
				{ keys: ["Shift+Click"], description: t("rangeSelect") },
				{ keys: ["E", "Enter"], description: t("editSelected") },
				{ keys: ["Delete"], description: t("deleteSelected") },
				{ keys: ["Esc"], description: t("clearSelection") },
			],
		},
		{
			title: t("forms"),
			shortcuts: [
				{ keys: ["Esc"], description: t("closeModal") },
			],
		},
	];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("shortcutsTitle")}</DialogTitle>
					<DialogDescription>
						{t("shortcutsDescription")}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					{groups.map((group) => (
						<div key={group.title}>
							<h4 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
								{group.title}
							</h4>
							<div className="space-y-1">
								{group.shortcuts.map((shortcut) => (
									<div
										key={shortcut.description}
										className="flex items-center justify-between py-1.5"
									>
										<span className="text-sm">{shortcut.description}</span>
										<div className="flex items-center gap-1">
											{shortcut.keys.map((key) => (
												<kbd
													key={key}
													className="inline-flex h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-muted-foreground text-xs"
												>
													{key}
												</kbd>
											))}
										</div>
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
