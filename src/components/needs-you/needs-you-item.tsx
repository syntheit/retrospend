"use client";

import {
	AlarmClock,
	CalendarClock,
	CircleAlert,
	CircleCheck,
	Coins,
	FileUp,
	Landmark,
	ListChecks,
	type LucideIcon,
	Mail,
	Plus,
	Repeat,
	Scale,
	UserCheck,
	UserX,
	Wallet,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { NeedsYouTarget } from "~/components/actions/needs-you";
import type { ActionHandlers } from "~/components/actions/types";
import { Money } from "~/components/money/money";
import { IconTile } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
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
	overspentMany: CircleAlert,
	rejected: UserX,
	overAssigned: Scale,
	billDue: CalendarClock,
	missingRate: Coins,
	startingMoney: Landmark,
	firstExpense: Plus,
	homeCurrency: Coins,
	verifyEmail: Mail,
	importStatement: FileUp,
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
	overspentMany: "cover",
	rejected: "edit",
	overAssigned: "takeBack",
	billDue: "fund",
	missingRate: "setRate",
	startingMoney: "confirm",
	firstExpense: "addExpense",
	homeCurrency: "choose",
	verifyEmail: "resend",
	importStatement: "import",
};

/** The one sentence of an item, from its kind. */
function useSentence() {
	const t = useTranslations("needsYou.text");
	return (item: NeedsYouItemVM): ReactNode => {
		switch (item.kind) {
			case "assign":
				return t.rich("assign", {
					amount: () => <Money value={item.amount} />,
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
			case "overspentMany":
				return t("overspentMany", { count: item.count });
			case "rejected":
				return t("rejected", { person: item.person, title: item.title });
			case "overAssigned":
				return t.rich("overAssigned", {
					amount: () => <Money value={item.amount} />,
				});
			case "billDue":
				return item.title
					? t("billDue", { title: item.title })
					: t("billsDue", { count: item.count });
			case "missingRate":
				return t("missingRate", { currencies: item.currencies.join(", ") });
			case "startingMoney":
			case "firstExpense":
			case "homeCurrency":
			case "verifyEmail":
			case "importStatement":
				return t(item.kind);
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
	onSecondary,
	menu,
	variant = "flat",
}: {
	item: NeedsYouItemVM;
	/** The action; an item with an href links instead. */
	onAction?: (item: NeedsYouItemVM) => void;
	/** The item's second action (`item.secondary`), a quiet link. */
	onSecondary?: (item: NeedsYouItemVM) => void;
	/** Handlers for the needsYou entity (open, later); none: no ⋯ menu. */
	menu?: ActionHandlers<NeedsYouTarget>;
	variant?: "flat" | "group";
}) {
	const t = useTranslations("needsYou.action");
	const sentence = useSentence()(item);
	const amount = "amount" in item ? item.amount : null;
	const label = t(
		item.action && t.has(item.action) ? item.action : ACTION[item.kind],
	);
	const group = variant === "group";
	const hasMenu = !!menu && Object.values(menu).some(Boolean);
	// The menu is named for the item ("More for Lucía says they paid you").
	const target = {
		id: item.id,
		name: typeof sentence === "string" ? sentence : label,
	};
	const meta: { key: string; node: ReactNode }[] = [];
	if (group && amount)
		meta.push({
			key: "amount",
			node: <Money figure={item.figure} value={amount} />,
		});
	if (item.context) meta.push({ key: "context", node: item.context });
	if (item.secondary && onSecondary && t.has(item.secondary))
		meta.push({
			key: "secondary",
			node: (
				<Button
					className="text-fg-3 text-meta can-hover:hover:bg-transparent inline h-auto px-0 whitespace-nowrap underline underline-offset-2"
					kind="ghost"
					onClick={() => onSecondary(item)}
				>
					{t(item.secondary)}
				</Button>
			),
		});
	const row = (
		<li
			className={cn(
				"min-h-row grid items-center gap-3 py-2",
				group && "bg-surface px-4",
				COLUMNS[`${group ? "group" : "flat"}${hasMenu ? "Menu" : ""}`],
			)}
			data-needs-you={item.kind}
		>
			{item.face ? (
				<Face imageUrl={item.face.imageUrl} name={item.face.name} />
			) : (
				<IconTile
					icon={ICON[item.kind]}
					tone={item.kind === "overdue" ? "attention" : "neutral"}
				/>
			)}
			<div className="text-body text-fg min-w-0 leading-snug">
				{sentence}
				{meta.length > 0 && (
					<span className="text-fg-3 text-meta block">
						{meta.map((m, i) => (
							<Fragment key={m.key}>
								{i > 0 && " · "}
								{m.node}
							</Fragment>
						))}
					</span>
				)}
			</div>
			{!group && (
				<span className="text-body text-fg-2">
					{amount && <Money figure={item.figure} value={amount} />}
				</span>
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
			{hasMenu && menu ? (
				<ActionMenu entity="needsYou" handlers={menu} target={target} />
			) : null}
		</li>
	);
	if (!hasMenu || !menu) return row;
	return (
		<ActionArea entity="needsYou" handlers={menu} target={target}>
			{row}
		</ActionArea>
	);
}

/** Lead, sentence, (amount,) action, (⋯). */
const COLUMNS = {
	flat: "grid-cols-[auto_minmax(0,1fr)_auto_auto]",
	flatMenu: "grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]",
	group: "grid-cols-[auto_minmax(0,1fr)_auto]",
	groupMenu: "grid-cols-[auto_minmax(0,1fr)_auto_auto]",
};
