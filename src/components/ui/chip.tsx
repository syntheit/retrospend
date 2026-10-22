"use client";

import { Check, ChevronDown, ListFilter } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	active?: boolean;
}

/** The old filter pill, kept for today's pages. New code uses FilterChip. */
export function Chip({ active, className, ...props }: ChipProps) {
	return (
		<button
			type="button"
			className={cn(
				"inline-flex cursor-pointer items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-all",
				active
					? "bg-primary text-primary-foreground hover:bg-primary/90"
					: "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

const chipBase =
	"inline-flex h-ctl shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-chip border px-3 font-medium text-body transition-colors duration-(--t-state) ease-land focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * A filter chip (FilterChips, R7, R25 amended by R31): text only, selected by
 * fill (brand-soft with a brand border), never by a tint or an icon tile.
 * `value` is a chip that shows a value (a date range): neutral, with a
 * chevron, opening a picker. People chips may lead with a face.
 */
export function FilterChip({
	selected = false,
	value = false,
	lead,
	className,
	children,
	...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> & {
	selected?: boolean;
	value?: boolean;
	/** A person's face only (R25 amended). */
	lead?: ReactNode;
}) {
	return (
		<button
			aria-pressed={value ? undefined : selected}
			className={cn(
				chipBase,
				value
					? "border-line-strong bg-surface text-fg"
					: selected
						? "border-brand bg-brand-soft text-fg"
						: "border-line-strong bg-transparent text-fg-2 can-hover:hover:bg-raised",
				className,
			)}
			type="button"
			{...props}
		>
			{lead}
			{children}
			{value && <ChevronDown aria-hidden="true" />}
		</button>
	);
}

/** One row of filter chips. Wraps on desktop, scrolls sideways on phones. */
export function FilterChips({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-2 max-md:flex-nowrap max-md:overflow-x-auto",
				className,
			)}
		>
			{children}
		</div>
	);
}

export type FilterMenuItem = {
	id: string;
	label: string;
	/** Identity in the one 24px lead slot: a face, cover, bare glyph or dot (R25). */
	lead?: ReactNode;
	checked: boolean;
};

export type FilterMenuGroup = {
	id: string;
	label: string;
	items: FilterMenuItem[];
};

/**
 * The "Filter" chip and its menu: every filter that has no chip of its own,
 * grouped, each with its identity. Chips show what is on; the menu adds more.
 */
export function FilterMenu({
	groups,
	onToggle,
	className,
}: {
	groups: FilterMenuGroup[];
	onToggle: (groupId: string, itemId: string, checked: boolean) => void;
	className?: string;
}) {
	const t = useTranslations("kit.filter");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					className={cn(
						chipBase,
						"border-line-strong text-fg-2 can-hover:hover:bg-raised",
						className,
					)}
					type="button"
				>
					<ListFilter aria-hidden="true" />
					{t("menu")}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="min-w-56 rounded-ctl border-line bg-surface shadow-menu"
			>
				{groups.map((g, gi) => (
					<Fragment key={g.id}>
						{gi > 0 && <DropdownMenuSeparator className="bg-line" />}
						<DropdownMenuLabel className="font-medium text-fg-3 text-meta">
							{g.label}
						</DropdownMenuLabel>
						{g.items.map((item) => (
							<DropdownMenuCheckboxItem
								checked={item.checked}
								className="h-ctl gap-2 rounded-ctl pr-2 pl-2 text-body text-fg focus:bg-raised focus:text-fg [&>span:first-child]:hidden"
								key={item.id}
								onCheckedChange={(on) => onToggle(g.id, item.id, on === true)}
								onSelect={(e) => e.preventDefault()}
							>
								<span className="flex size-6 shrink-0 items-center justify-center">
									{item.lead}
								</span>
								<span className="min-w-0 flex-1 truncate">{item.label}</span>
								{item.checked && (
									<Check aria-hidden="true" className="text-brand" />
								)}
							</DropdownMenuCheckboxItem>
						))}
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
