"use client";

import { Check, ChevronDown, ListFilter } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	type FocusEvent,
	Fragment,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	useLayoutEffect,
	useRef,
} from "react";
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
			className={cn(
				"inline-flex cursor-pointer items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-all",
				active
					? "bg-primary text-primary-foreground hover:bg-primary/90"
					: "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
				className,
			)}
			type="button"
			{...props}
		/>
	);
}

const chipBase =
	"inline-flex h-ctl shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-chip border px-3 font-medium text-body transition-colors duration-(--t-state) ease-land focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * A filter chip (FilterChips, R7, R25 amended by R31): text only, selected by
 * fill (brand-soft with a brand border), never by a tint or an icon tile.
 * `value` is a chip that shows a value (a date range): neutral, with a
 * chevron, opening a picker. A chip may lead with identity, never a tile:
 * a face, a bare category glyph in its color, a project cover, a flag.
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
	/** Identity only (R25 amended): a person's face, a bare category glyph, a project cover. */
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
						: "border-line-strong text-fg-2 can-hover:hover:bg-raised bg-transparent",
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

/** The chips (and the Filter menu chip) a FilterChips row moves between. */
const STOPS = ":scope > button, :scope > * > button";

function stopsOf(row: HTMLElement): HTMLButtonElement[] {
	// A chip kept for measuring (visibility hidden) is not a stop.
	return [...row.querySelectorAll<HTMLButtonElement>(STOPS)].filter(
		(b) => !b.disabled && getComputedStyle(b).visibility !== "hidden",
	);
}

/**
 * One row of filter chips. Wraps on desktop, scrolls sideways on phones.
 * The row is one tab stop (kit `data-rove`): Tab enters at the last chip
 * used (else the first selected, else the first), the arrow keys, Home and
 * End move between chips, and Tab leaves the row.
 */
export function FilterChips({
	className,
	children,
	label,
	ref: outer,
}: {
	className?: string;
	children: ReactNode;
	/** Accessible name of the group ("Filter people"). */
	label?: string;
	/** The row element, for a caller that measures it (fit to one line). */
	ref?: Ref<HTMLDivElement>;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const last = useRef<HTMLButtonElement | null>(null);
	// Every render: chips come and go with the filters.
	useLayoutEffect(() => {
		const row = ref.current;
		if (!row) return;
		const stops = stopsOf(row);
		const current =
			(last.current && stops.includes(last.current) && last.current) ||
			stops.find((b) => b.getAttribute("aria-pressed") === "true") ||
			stops[0];
		for (const b of stops) b.tabIndex = b === current ? 0 : -1;
	});
	const onFocus = (e: FocusEvent<HTMLDivElement>) => {
		const row = ref.current;
		if (!row || !(e.target instanceof HTMLButtonElement)) return;
		const stops = stopsOf(row);
		if (!stops.includes(e.target)) return;
		last.current = e.target;
		for (const b of stops) b.tabIndex = b === e.target ? 0 : -1;
	};
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const row = ref.current;
		// Keys typed inside a picker a chip opened (a portal) are not for the row.
		if (!row || !(e.target instanceof HTMLButtonElement)) return;
		const stops = stopsOf(row);
		const at = stops.indexOf(e.target);
		if (at < 0) return;
		const to =
			e.key === "ArrowRight" || e.key === "ArrowDown"
				? (at + 1) % stops.length
				: e.key === "ArrowLeft" || e.key === "ArrowUp"
					? (at - 1 + stops.length) % stops.length
					: e.key === "Home"
						? 0
						: e.key === "End"
							? stops.length - 1
							: -1;
		if (to < 0) return;
		e.preventDefault();
		stops[to]?.focus();
	};
	return (
		<div
			aria-label={label}
			className={cn(
				"flex flex-wrap items-center gap-2 max-md:flex-nowrap max-md:overflow-x-auto",
				className,
			)}
			onFocus={onFocus}
			onKeyDown={onKeyDown}
			ref={(el) => {
				ref.current = el;
				if (typeof outer === "function") outer(el);
				else if (outer) outer.current = el;
			}}
			role="group"
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
				className="rounded-ctl border-line bg-surface shadow-menu min-w-56"
			>
				{groups.map((g, gi) => (
					<Fragment key={g.id}>
						{gi > 0 && <DropdownMenuSeparator className="bg-line" />}
						<DropdownMenuLabel className="text-fg-3 text-meta font-medium">
							{g.label}
						</DropdownMenuLabel>
						{g.items.map((item) => (
							<DropdownMenuCheckboxItem
								checked={item.checked}
								className="h-ctl rounded-ctl text-body text-fg focus:bg-raised focus:text-fg gap-2 pr-2 pl-2 [&>span:first-child]:hidden"
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
