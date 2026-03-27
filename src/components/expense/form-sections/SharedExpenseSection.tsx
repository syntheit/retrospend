"use client";

import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import type { SplitParticipant } from "~/components/split-with-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { ExpenseFormData } from "~/hooks/use-expense-form";
import { formatNumber } from "~/lib/currency-format";
import { cn } from "~/lib/utils";

type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

/** High-level UI split choice — maps to internal SplitMode values. */
type SplitChoice = "even" | "full" | "custom";

/** Sub-mode within "custom" */
type CustomSubMode = "amount" | "percentage" | "shares";

interface SharedExpenseSectionProps {
	splitWith: SplitParticipant[];
	currentUser: { id: string; name: string; avatarUrl?: string | null };
	splitMode: SplitMode;
	onSplitModeChange: (
		mode: SplitMode,
		computedAmounts?: Record<string, number>,
	) => void;
	paidBy: { participantType: string; participantId: string };
	onPaidByChange: (ref: {
		participantType: string;
		participantId: string;
	}) => void;
	exactAmounts: Record<string, number>;
	onExactAmountChange: (key: string, amount: number) => void;
	percentages: Record<string, number>;
	onPercentageChange: (key: string, pct: number) => void;
	shares: Record<string, number>;
	onSharesChange: (key: string, units: number) => void;
	theyOweFullAmount: boolean;
	onTheyOweFullAmountChange: (value: boolean) => void;
}

export function SharedExpenseSection({
	splitWith,
	currentUser,
	splitMode,
	onSplitModeChange,
	paidBy,
	onPaidByChange,
	exactAmounts,
	onExactAmountChange,
	percentages,
	onPercentageChange,
	shares,
	onSharesChange,
	theyOweFullAmount,
	onTheyOweFullAmountChange,
}: SharedExpenseSectionProps) {
	const { watch } = useFormContext<ExpenseFormData>();
	const { getCurrencySymbol } = useCurrencyFormatter();

	const watchedAmount = watch("amount");
	const watchedCurrency = watch("currency");
	const currencySymbol = getCurrencySymbol(watchedCurrency);
	const amount = watchedAmount || 0;

	const allParticipants = useMemo(
		() => [
			{
				participantType: "user" as const,
				participantId: currentUser.id,
				name: currentUser.name,
				label: `${currentUser.name} (you)`,
				avatarUrl: currentUser.avatarUrl ?? null,
			},
			...splitWith.map((p) => ({
				participantType: p.participantType,
				participantId: p.participantId,
				name: p.name,
				label: p.name,
				avatarUrl: p.avatarUrl ?? null,
			})),
		],
		[currentUser, splitWith],
	);

	const isSinglePerson = splitWith.length === 1;
	const isMultiPerson = splitWith.length >= 2;

	// Determine the current payer
	const paidByPerson = allParticipants.find(
		(p) =>
			p.participantType === paidBy.participantType &&
			p.participantId === paidBy.participantId,
	);
	const youPaid =
		paidBy.participantType === "user" &&
		paidBy.participantId === currentUser.id;

	// --- Derive UI split choice from internal state ---
	const [customSubMode, setCustomSubMode] = useState<CustomSubMode>("amount");

	const splitChoice: SplitChoice = useMemo(() => {
		if (theyOweFullAmount && isSinglePerson && splitMode === "EQUAL")
			return "full";
		if (splitMode === "EQUAL" && !theyOweFullAmount) return "even";
		if (splitMode === "EXACT" || splitMode === "PERCENTAGE" || splitMode === "SHARES")
			return "custom";
		return "even";
	}, [splitMode, theyOweFullAmount, isSinglePerson]);

	// Compute current amounts as a map for passing to onSplitModeChange
	const getCurrentComputedAmounts = () => {
		const map: Record<string, number> = {};
		for (const s of shares_computed) {
			map[`${s.participantType}:${s.participantId}`] = s.amount;
		}
		return map;
	};

	// --- Handle split choice changes ---
	const handleSplitChoiceChange = (choice: SplitChoice) => {
		if (choice === "even") {
			onTheyOweFullAmountChange(false);
			onSplitModeChange("EQUAL");
		} else if (choice === "full") {
			if (isSinglePerson) {
				// Set mode to EQUAL first (no-ops if already EQUAL, but resets
				// theyOweFullAmount internally), then set the flag to true after.
				// Order matters: onSplitModeChange("EQUAL") resets theyOweFullAmount
				// to false, so we must set it to true *after*.
				onSplitModeChange("EQUAL");
				onTheyOweFullAmountChange(true);
			}
		} else if (choice === "custom") {
			onTheyOweFullAmountChange(false);
			if (customSubMode === "amount") {
				onSplitModeChange("EXACT", getCurrentComputedAmounts());
			} else if (customSubMode === "percentage") {
				onSplitModeChange("PERCENTAGE");
			} else {
				onSplitModeChange("SHARES");
			}
		}
	};

	const handleCustomSubModeChange = (sub: CustomSubMode) => {
		setCustomSubMode(sub);
		if (sub === "amount") {
			onSplitModeChange("EXACT", getCurrentComputedAmounts());
		} else if (sub === "percentage") {
			onSplitModeChange("PERCENTAGE");
		} else {
			onSplitModeChange("SHARES");
		}
	};

	// --- Compute per-person shares for display ---
	const shares_computed = useMemo(() => {
		if (splitMode === "EQUAL") {
			if (isSinglePerson && theyOweFullAmount) {
				return allParticipants.map((p) => ({
					...p,
					amount: p.participantId === currentUser.id ? 0 : amount,
				}));
			}
			const count = allParticipants.length;
			const totalCents = Math.round(amount * 100);
			const baseCents = Math.floor(totalCents / count);
			let remainder = totalCents - baseCents * count;

			return allParticipants.map((p) => {
				let cents = baseCents;
				if (remainder > 0) {
					cents += 1;
					remainder -= 1;
				}
				return { ...p, amount: cents / 100 };
			});
		}

		if (splitMode === "EXACT") {
			return allParticipants.map((p) => ({
				...p,
				amount: exactAmounts[`${p.participantType}:${p.participantId}`] ?? 0,
			}));
		}

		if (splitMode === "PERCENTAGE") {
			const totalCents = Math.round(amount * 100);
			return allParticipants.map((p) => {
				const key = `${p.participantType}:${p.participantId}`;
				const pct = percentages[key] ?? 0;
				return {
					...p,
					amount: Math.floor((totalCents * pct) / 100) / 100,
				};
			});
		}

		// SHARES
		const totalUnits = allParticipants.reduce((s, p) => {
			const key = `${p.participantType}:${p.participantId}`;
			return s + (shares[key] ?? 1);
		}, 0);
		const totalCents = Math.round(amount * 100);
		return allParticipants.map((p) => {
			const key = `${p.participantType}:${p.participantId}`;
			const units = shares[key] ?? 1;
			return {
				...p,
				amount:
					totalUnits > 0
						? Math.floor((totalCents * units) / totalUnits) / 100
						: 0,
			};
		});
	}, [
		splitMode,
		allParticipants,
		amount,
		exactAmounts,
		percentages,
		shares,
		isSinglePerson,
		theyOweFullAmount,
		currentUser.id,
	]);

	// --- Validation ---
	const exactTotal = useMemo(() => {
		if (splitMode !== "EXACT") return 0;
		return shares_computed.reduce((s, p) => s + p.amount, 0);
	}, [splitMode, shares_computed]);

	const exactDiff = splitMode === "EXACT" ? amount - exactTotal : 0;
	const exactValid = splitMode === "EXACT" ? Math.abs(exactDiff) < 0.01 : true;

	const percentageTotal = useMemo(() => {
		if (splitMode !== "PERCENTAGE") return 0;
		return allParticipants.reduce((s, p) => {
			const key = `${p.participantType}:${p.participantId}`;
			return s + (percentages[key] ?? 0);
		}, 0);
	}, [splitMode, allParticipants, percentages]);

	const percentageDiff = splitMode === "PERCENTAGE" ? 100 - percentageTotal : 0;
	const percentageValid =
		splitMode === "PERCENTAGE" ? Math.abs(percentageDiff) < 0.01 : true;

	const totalShareUnits = useMemo(() => {
		if (splitMode !== "SHARES") return 0;
		return allParticipants.reduce((s, p) => {
			const key = `${p.participantType}:${p.participantId}`;
			return s + (shares[key] ?? 1);
		}, 0);
	}, [splitMode, allParticipants, shares]);

	const perShareAmount =
		totalShareUnits > 0 ? amount / totalShareUnits : 0;

	// --- "Paid By" overflow: pills for <= 3 people, dropdown for 4+ ---
	const usePaidByPills = allParticipants.length <= 3;

	// --- Summary text ---
	const summaryText = useMemo(() => {
		if (amount <= 0) return null;

		if (splitChoice === "even") {
			if (allParticipants.length === 2) {
				return `Each person pays ${currencySymbol}${formatNumber(amount / 2, 2)}`;
			}
			const perPerson = Math.floor(Math.round(amount * 100) / allParticipants.length) / 100;
			return `Each person pays ${currencySymbol}${formatNumber(perPerson, 2)}`;
		}

		if (splitChoice === "full" && isSinglePerson) {
			const otherName = splitWith[0]!.name;
			if (youPaid) {
				return `${otherName} owes you ${currencySymbol}${formatNumber(amount, 2)}`;
			}
			return `You owe ${otherName} ${currencySymbol}${formatNumber(amount, 2)}`;
		}

		if (splitChoice === "custom") {
			if (allParticipants.length === 2) {
				const myComputed = shares_computed.find(
					(s) => s.participantId === currentUser.id,
				);
				const otherComputed = shares_computed.find(
					(s) => s.participantId !== currentUser.id,
				);
				if (myComputed && otherComputed) {
					return `You pay ${currencySymbol}${formatNumber(myComputed.amount, 2)} · ${otherComputed.name} pays ${currencySymbol}${formatNumber(otherComputed.amount, 2)}`;
				}
			}
			return null; // Too complex for a single line with 3+
		}

		return null;
	}, [amount, splitChoice, allParticipants, isSinglePerson, splitWith, youPaid, currencySymbol, shares_computed, currentUser.id]);

	// Determine if we're in an editable (custom) mode
	const isEditable = splitChoice === "custom";

	// Dropdown state for 4+ paid-by
	const [paidByOpen, setPaidByOpen] = useState(false);

	return (
		<div className="fade-in slide-in-from-top-2 animate-in space-y-3">
			{/* Who paid? */}
			<div className="space-y-1.5">
				<Label className="font-semibold text-sm">Who paid?</Label>
				{usePaidByPills ? (
					<div className="flex gap-2">
						{allParticipants.map((p) => {
							const isSelected =
								paidBy.participantType === p.participantType &&
								paidBy.participantId === p.participantId;
							const isYou =
								p.participantType === "user" &&
								p.participantId === currentUser.id;
							return (
								<button
									className={cn(
										"flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
										isSelected
											? "border-primary bg-primary/10 text-primary"
											: "border-border bg-transparent text-foreground hover:bg-muted/50",
									)}
									key={`${p.participantType}:${p.participantId}`}
									onClick={() =>
										onPaidByChange({
											participantType: p.participantType,
											participantId: p.participantId,
										})
									}
									type="button"
								>
									<UserAvatar
										avatarUrl={p.avatarUrl}
										name={p.name}
										size="xs"
									/>
									<span className="truncate">
										{isYou ? "You paid" : `${p.name} paid`}
									</span>
								</button>
							);
						})}
					</div>
				) : (
					<Popover onOpenChange={setPaidByOpen} open={paidByOpen}>
						<PopoverTrigger asChild>
							<Button
								aria-expanded={paidByOpen}
								className="w-full justify-between"
								role="combobox"
								type="button"
								variant="outline"
							>
								<span className="flex items-center gap-2">
									{paidByPerson && (
										<UserAvatar
											avatarUrl={paidByPerson.avatarUrl}
											name={paidByPerson.name}
											size="xs"
										/>
									)}
									{paidByPerson
										? youPaid
											? "You paid"
											: `${paidByPerson.name} paid`
										: "Select who paid"}
								</span>
								<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-[var(--radix-popover-trigger-width)] p-1"
						>
							{allParticipants.map((p) => {
								const isSelected =
									paidBy.participantType === p.participantType &&
									paidBy.participantId === p.participantId;
								return (
									<Button
										className="h-auto w-full justify-start gap-2 px-3 py-2"
										key={`${p.participantType}:${p.participantId}`}
										onClick={() => {
											onPaidByChange({
												participantType: p.participantType,
												participantId: p.participantId,
											});
											setPaidByOpen(false);
										}}
										type="button"
										variant="ghost"
									>
										<Check
											className={cn(
												"h-4 w-4",
												isSelected ? "opacity-100" : "opacity-0",
											)}
										/>
										<UserAvatar
											avatarUrl={p.avatarUrl}
											name={p.name}
											size="xs"
										/>
										{p.label}
									</Button>
								);
							})}
						</PopoverContent>
					</Popover>
				)}
			</div>

			{/* How to split? */}
			<div className="space-y-2">
				<Label className="font-semibold text-sm">How to split?</Label>
				<div className="flex gap-2">
					{/* Split evenly */}
					<button
						className={cn(
							"flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-3 py-2.5 text-center transition-colors",
							splitChoice === "even"
								? "border-primary bg-primary/8 text-primary"
								: "border-border bg-transparent hover:bg-muted/50",
						)}
						onClick={() => handleSplitChoiceChange("even")}
						type="button"
					>
						<span className="font-medium text-sm">Split evenly</span>
						<span className="text-[11px] text-muted-foreground">
							{allParticipants.length === 2 ? "50/50" : "Equal shares"}
						</span>
					</button>

					{/* They owe all / You owe all — only for single-person splits */}
					{isSinglePerson && (
						<button
							className={cn(
								"flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-3 py-2.5 text-center transition-colors",
								splitChoice === "full"
									? "border-primary bg-primary/8 text-primary"
									: "border-border bg-transparent hover:bg-muted/50",
							)}
							onClick={() => handleSplitChoiceChange("full")}
							type="button"
						>
							<span className="font-medium text-sm">
								{youPaid ? "They owe all" : "You owe all"}
							</span>
							<span className="text-[11px] text-muted-foreground">
								Full amount
							</span>
						</button>
					)}

					{/* For multi-person, show "One owes all" with a person picker — skip for now, just show Custom */}

					{/* Custom */}
					<button
						className={cn(
							"flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-3 py-2.5 text-center transition-colors",
							splitChoice === "custom"
								? "border-primary bg-primary/8 text-primary"
								: "border-border bg-transparent hover:bg-muted/50",
						)}
						onClick={() => handleSplitChoiceChange("custom")}
						type="button"
					>
						<span className="font-medium text-sm">Custom</span>
						<span className="text-[11px] text-muted-foreground">
							Set exact amounts
						</span>
					</button>
				</div>

				{/* Custom sub-mode toggle */}
				{splitChoice === "custom" && (
					<div className="ml-1 flex items-center gap-1">
						{(
							[
								{ key: "amount", label: "By amount" },
								{ key: "percentage", label: "By %" },
								{ key: "shares", label: "By shares" },
							] as const
						).map(({ key, label }) => (
							<button
								className={cn(
									"cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors",
									customSubMode === key
										? "border-primary bg-primary/10 text-primary"
										: "border-border bg-transparent text-muted-foreground hover:text-foreground",
								)}
								key={key}
								onClick={() => handleCustomSubModeChange(key)}
								type="button"
							>
								{label}
							</button>
						))}
					</div>
				)}
			</div>

			{/* Split preview — per-person rows */}
			<div className="space-y-0.5 border-t border-border pt-2">
				{allParticipants.map((p, idx) => {
					const key = `${p.participantType}:${p.participantId}`;
					const computed = shares_computed[idx];
					const isYou =
						p.participantType === "user" &&
						p.participantId === currentUser.id;
					const pctOfTotal =
						amount > 0 && computed
							? Math.round((computed.amount / amount) * 100)
							: 0;

					return (
						<div
							className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5"
							key={key}
						>
							{/* Left: avatar + name + percentage */}
							<div className="flex min-w-0 items-center gap-2">
								<UserAvatar
									avatarUrl={p.avatarUrl}
									name={p.name}
									size="xs"
								/>
								<div className="min-w-0">
									<span className="block truncate text-sm font-medium">
										{isYou ? "You" : p.name}
									</span>
									{amount > 0 && splitChoice !== "custom" && (
										<span className="block text-[11px] text-muted-foreground">
											{pctOfTotal}% of total
										</span>
									)}
								</div>
							</div>

							{/* Right: amount display or input */}
							<div className="shrink-0">
								{/* EXACT mode — editable */}
								{isEditable && splitMode === "EXACT" && (
									<div className="flex items-center gap-1">
										<span className="text-muted-foreground text-sm">
											{currencySymbol}
										</span>
										<Input
											aria-label={`Amount for ${isYou ? "you" : p.name}`}
											className="h-8 w-24 text-right text-sm"
											inputMode="decimal"
											onChange={(e) =>
												onExactAmountChange(
													key,
													Number(e.target.value) || 0,
												)
											}
											type="text"
											value={exactAmounts[key] ?? ""}
										/>
									</div>
								)}

								{/* PERCENTAGE mode — editable */}
								{isEditable && splitMode === "PERCENTAGE" && (
									<div className="flex items-center gap-2">
										<span className="text-muted-foreground text-xs tabular-nums">
											{currencySymbol}
											{formatNumber(computed?.amount ?? 0, 2)}
										</span>
										<div className="flex items-center gap-1">
											<Input
												aria-label={`Percentage for ${isYou ? "you" : p.name}`}
												className="h-8 w-16 text-right text-sm"
												inputMode="decimal"
												onChange={(e) =>
													onPercentageChange(
														key,
														Number(e.target.value) || 0,
													)
												}
												type="text"
												value={percentages[key] ?? ""}
											/>
											<span className="text-muted-foreground text-sm">%</span>
										</div>
									</div>
								)}

								{/* SHARES mode — editable */}
								{isEditable && splitMode === "SHARES" && (
									<div className="flex items-center gap-2">
										<span className="text-muted-foreground text-xs tabular-nums">
											{currencySymbol}
											{formatNumber(computed?.amount ?? 0, 2)}
										</span>
										<div className="flex items-center gap-1">
											<Button
												aria-label={`Decrease shares for ${isYou ? "you" : p.name}`}
												className="h-8 w-8 p-0"
												onClick={() =>
													onSharesChange(
														key,
														Math.max(1, (shares[key] ?? 1) - 1),
													)
												}
												type="button"
												variant="outline"
											>
												<Minus className="h-3 w-3" />
											</Button>
											<span className="w-8 text-center text-sm tabular-nums">
												{shares[key] ?? 1}
											</span>
											<Button
												aria-label={`Increase shares for ${isYou ? "you" : p.name}`}
												className="h-8 w-8 p-0"
												onClick={() =>
													onSharesChange(key, (shares[key] ?? 1) + 1)
												}
												type="button"
												variant="outline"
											>
												<Plus className="h-3 w-3" />
											</Button>
										</div>
									</div>
								)}

								{/* Non-editable modes (even / full) */}
								{!isEditable && (
									<span className="font-medium text-sm tabular-nums">
										{currencySymbol}
										{formatNumber(computed?.amount ?? 0, 2)}
									</span>
								)}
							</div>
						</div>
					);
				})}
			</div>

			{/* Validation messages for custom modes */}
			{splitMode === "EXACT" && splitChoice === "custom" && !exactValid && (
				<div className="flex items-center justify-between rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-sm dark:text-amber-400">
					<span>
						Split total: {currencySymbol}
						{formatNumber(exactTotal, 2)} / {currencySymbol}
						{formatNumber(amount, 2)}
					</span>
					<span>
						{currencySymbol}
						{formatNumber(Math.abs(exactDiff), 2)}{" "}
						{exactDiff > 0 ? "remaining" : "over"}
					</span>
				</div>
			)}

			{splitMode === "PERCENTAGE" && splitChoice === "custom" && !percentageValid && (
				<div className="flex items-center justify-between rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-sm dark:text-amber-400">
					<span>Total: {formatNumber(percentageTotal, 1)}%</span>
					<span>
						{formatNumber(Math.abs(percentageDiff), 1)}%{" "}
						{percentageDiff > 0 ? "remaining" : "over"}
					</span>
				</div>
			)}

			{splitMode === "SHARES" && splitChoice === "custom" && (
				<div className="rounded-md bg-muted/60 px-3 py-2 text-muted-foreground text-sm">
					{totalShareUnits} total share
					{totalShareUnits !== 1 ? "s" : ""} · {currencySymbol}
					{formatNumber(perShareAmount, 2)} per share
				</div>
			)}

			{/* Summary line */}
			{summaryText && amount > 0 && (
				<div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-center text-emerald-700 text-sm dark:text-emerald-400">
					{summaryText}
				</div>
			)}
		</div>
	);
}
