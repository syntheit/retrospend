"use client";

import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";

/** On the brand fill: brand-fg text, a brand-fg focus ring and hover tint. */
const ON_BRAND =
	"text-brand-fg can-hover:hover:bg-brand-fg/15 can-hover:hover:text-brand-fg focus-visible:outline-brand-fg";

/**
 * The selection bar over a table (kit `.bulkbar`, activity.html): how many
 * rows are selected, what can be done to all of them, and Clear. It shows
 * only while something is selected; selection is the brand's job (§2.1).
 */
export function BulkBar({
	count,
	onClear,
	children,
	className,
}: {
	count: number;
	onClear: () => void;
	/** BulkAction buttons, from the bulk list of the page's entity. */
	children: ReactNode;
	className?: string;
}) {
	const t = useTranslations("rows.table");
	if (count === 0) return null;
	return (
		<div
			aria-label={t("selection")}
			className={cn(
				"bg-brand text-brand-fg rounded-panel mb-2 flex h-11 items-center gap-2 px-3",
				className,
			)}
			data-slot="bulk-bar"
			role="toolbar"
		>
			<span className="mr-auto font-semibold whitespace-nowrap">
				{t("selected", { count })}
			</span>
			{children}
			<Button className={ON_BRAND} kind="ghost" onClick={onClear} size="sm">
				{t("clear")}
			</Button>
		</div>
	);
}

/** One action on every selected row; a pick (Categorize) opens its menu. */
export function BulkAction({
	icon: Icon,
	label,
	onClick,
	...rest
}: {
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
} & Omit<ComponentProps<typeof Button>, "kind" | "children" | "icon">) {
	return (
		<Button
			{...rest}
			className={cn(ON_BRAND, rest.className)}
			kind="ghost"
			onClick={onClick}
			size="sm"
		>
			<Icon aria-hidden="true" />
			{label}
		</Button>
	);
}
