"use client";

import {
	AlarmClock,
	CircleAlert,
	CircleCheck,
	ListChecks,
	type LucideIcon,
	Repeat,
	UserCheck,
	Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { IconTile } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";
import type { NeedsYouItemVM, NeedsYouKind } from "./types";

const ICON: Record<NeedsYouKind, LucideIcon> = {
	assign: Wallet,
	review: ListChecks,
	confirmPayment: CircleCheck,
	verify: UserCheck,
	due: Repeat,
	overdue: AlarmClock,
	overspent: CircleAlert,
};

/** The one action per kind. */
const ACTION: Record<NeedsYouKind, string> = {
	assign: "assign",
	review: "review",
	confirmPayment: "confirm",
	verify: "review",
	due: "confirm",
	overdue: "confirm",
	overspent: "cover",
};

/** The one sentence of an item, from its kind. */
function useSentence() {
	const t = useTranslations("needsYou.text");
	const locale = useLocale();
	return (item: NeedsYouItemVM): string => {
		switch (item.kind) {
			case "assign":
				return t("assign", {
					amount: formatMoney(item.amount, { locale }) ?? "",
				});
			case "review":
				return t("review", { count: item.count });
			case "confirmPayment":
				return t("confirmPayment", { person: item.person });
			case "verify":
				return t("verify", { person: item.person, title: item.title });
			case "due":
				return t("due", { title: item.title });
			case "overdue":
				return t("overdue", { title: item.title });
			case "overspent":
				return t("overspent", { envelope: item.envelope });
		}
	};
}

/**
 * NeedsYouItem: what, who, one action. Desktop puts the amount in its own
 * column before the action; a phone list group moves it under the sentence.
 * Overdue tints its icon with attention, and the sentence says the word.
 */
export function NeedsYouItem({
	item,
	onAction,
	variant = "flat",
}: {
	item: NeedsYouItemVM;
	/** The action; an item with an href links instead. */
	onAction?: (item: NeedsYouItemVM) => void;
	variant?: "flat" | "group";
}) {
	const t = useTranslations("needsYou.action");
	const sentence = useSentence()(item);
	const amount = "amount" in item ? item.amount : null;
	const label = t(ACTION[item.kind]);
	const group = variant === "group";
	return (
		<li
			className={cn(
				"min-h-row grid items-center gap-3 py-2",
				group
					? "bg-surface grid-cols-[auto_1fr_auto] px-4"
					: "grid-cols-[auto_1fr_auto_auto]",
			)}
			data-needs-you={item.kind}
		>
			<IconTile
				icon={ICON[item.kind]}
				tone={item.kind === "overdue" ? "attention" : "neutral"}
			/>
			<div className="text-body text-fg min-w-0 leading-snug">
				{sentence}
				{group && amount && (
					<Money className="text-fg-3 text-meta block" value={amount} />
				)}
			</div>
			{!group && (
				<span className="text-fg-2">{amount && <Money value={amount} />}</span>
			)}
			{item.href ? (
				<Button asChild kind="secondary" size="sm">
					<Link href={item.href}>{label}</Link>
				</Button>
			) : (
				<Button kind="secondary" onClick={() => onAction?.(item)} size="sm">
					{label}
				</Button>
			)}
		</li>
	);
}
