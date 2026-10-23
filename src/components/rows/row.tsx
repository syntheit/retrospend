"use client";

import Link from "next/link";
import {
	type ComponentProps,
	createContext,
	isValidElement,
	type ReactNode,
	useContext,
} from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";

/**
 * The one row anatomy every entity row shares (GUIDELINE §6): one lead slot,
 * a title over a subline, money at the end, then the trailing ⋯ column.
 *
 * - `flat`: desktop lists. Hairlines, no fill, hover tone on fine pointers,
 *   the ⋯ shows on hover or focus.
 * - `group`: phone list groups. Surface fill, 16px inset, bordered group,
 *   the ⋯ always shows (no hover on touch, R13).
 * - `auto`: flat on desktop, group under 768px.
 */
export type RowVariant = "flat" | "group" | "auto";

const VariantContext = createContext<RowVariant>("auto");

export function useRowVariant() {
	return useContext(VariantContext);
}

const LIST: Record<RowVariant, string> = {
	flat: "",
	group: "overflow-hidden rounded-panel border border-line bg-surface",
	auto: "max-md:overflow-hidden max-md:rounded-panel max-md:border max-md:border-line max-md:bg-surface",
};

/** A list of rows: hairlines between them, a group on phone. */
export function RowList({
	variant = "auto",
	label,
	children,
	className,
}: {
	variant?: RowVariant;
	/** Accessible name of the list. */
	label?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<VariantContext.Provider value={variant}>
			<ul
				aria-label={label}
				className={cn(
					"*:border-line flex flex-col *:border-b *:last:border-b-0",
					LIST[variant],
					className,
				)}
				data-slot="row-list"
			>
				{children}
			</ul>
		</VariantContext.Provider>
	);
}

const ROW: Record<RowVariant, string> = {
	flat: "before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:bg-raised before:opacity-0 can-hover:hover:before:opacity-100",
	group: "bg-surface px-4",
	auto: "max-md:bg-surface max-md:px-4 md:before:absolute md:before:inset-y-0 md:before:-inset-x-2 md:before:-z-10 md:before:bg-raised md:before:opacity-0 md:can-hover:hover:before:opacity-100",
};

/** What a wrapper (ActionArea, SwipeActions) may hand a row: events, ref, data. */
export type RowPassThrough = Omit<ComponentProps<"li">, "title" | "children">;

/**
 * One row. `open` is what a tap or click on the row does: a link (`href`) or
 * an action (`onOpen`). It covers the whole row; the ⋯ and any end buttons
 * sit above it and keep their own clicks.
 */
export function Row({
	lead,
	title,
	titleEnd,
	sub,
	end,
	actions,
	open,
	className,
	...rest
}: {
	lead?: ReactNode;
	title: ReactNode;
	/** Next to the title (a status dot). */
	titleEnd?: ReactNode;
	/** The subline, usually RowSub. */
	sub?: ReactNode;
	/** Money (and its words) at the right edge. */
	end?: ReactNode;
	/** The ⋯ menu button, from the action registry (R8). */
	actions?: ReactNode;
	open?: { href: string } | { onOpen: () => void; label: string };
	className?: string;
} & RowPassThrough) {
	const variant = useRowVariant();
	return (
		<li
			className={cn(
				"group/row min-h-row relative isolate grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 transition-colors duration-(--t-state)",
				lead != null && "grid-cols-[auto_minmax(0,1fr)_auto]",
				actions != null && "grid-cols-[minmax(0,1fr)_auto_auto]",
				lead != null &&
					actions != null &&
					"grid-cols-[auto_minmax(0,1fr)_auto_auto]",
				ROW[variant],
				className,
			)}
			{...rest}
		>
			{lead}
			<div className="min-w-0 leading-snug">
				<div className="text-body text-fg flex min-w-0 items-center gap-2 font-medium">
					<RowTitle open={open}>{title}</RowTitle>
					{titleEnd}
				</div>
				{sub}
			</div>
			{end != null && (
				<div className="text-body relative z-10 flex flex-col items-end gap-0.5 text-right leading-snug">
					{end}
				</div>
			)}
			{actions != null && <RowMore>{actions}</RowMore>}
		</li>
	);
}

/** The covering link or button lives on the title, so the row has one name. */
function RowTitle({
	open,
	children,
}: {
	open?: { href: string } | { onOpen: () => void; label: string };
	children: ReactNode;
}) {
	const cover =
		"truncate after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2";
	if (!open) return <span className="truncate">{children}</span>;
	if ("href" in open)
		return (
			<Link className={cn(cover, "rounded-ctl")} href={open.href}>
				{children}
			</Link>
		);
	return (
		<Button
			aria-label={open.label}
			className={cn(
				cover,
				"text-body text-fg can-hover:hover:bg-transparent can-hover:hover:text-fg static h-auto min-w-0 shrink justify-start border-0 px-0",
			)}
			kind="ghost"
			onClick={open.onOpen}
		>
			<span className="truncate">{children}</span>
		</Button>
	);
}

/** The trailing ⋯ column: hover-revealed on desktop lists, always on phone. */
function RowMore({ children }: { children: ReactNode }) {
	const variant = useRowVariant();
	return (
		<div
			className={cn(
				"w-ctl relative z-10 flex justify-end",
				variant === "flat" &&
					"can-hover:opacity-0 can-hover:group-hover/row:opacity-100 can-hover:focus-within:opacity-100",
				variant === "auto" &&
					"md:can-hover:opacity-0 md:can-hover:group-hover/row:opacity-100 md:can-hover:focus-within:opacity-100",
			)}
		>
			{children}
		</div>
	);
}

/** A subline part that may give way with an ellipsis when the row is narrow. */
export type Shrinkable = { shrink: ReactNode };
/** A subline part that never shrinks, even last (a stack of faces). */
export type Kept = { keep: ReactNode };

function isMarked<K extends string>(
	p: unknown,
	key: K,
): p is Record<K, ReactNode> {
	return typeof p === "object" && p !== null && !isValidElement(p) && key in p;
}
const isShrinkable = (p: unknown): p is Shrinkable => isMarked(p, "shrink");
const isKept = (p: unknown): p is Kept => isMarked(p, "keep");

/**
 * The subline: small fg-3 parts on one line with a dot between them. Like
 * the kit, the last part and any part marked `{ shrink }` give way with an
 * ellipsis (a last part marked `{ keep }`, such as faces, does not); the
 * rest keep their width, and nothing spills out of the row.
 */
export function RowSub({
	parts,
	className,
}: {
	/** Each part; falsy parts are left out. */
	parts: (ReactNode | Shrinkable | Kept)[];
	className?: string;
}) {
	const empty = (p: unknown) => p == null || p === false || p === "";
	// A shrinkable part with nothing in it is left out too (no stray separator).
	const shown = parts.filter(
		(p) => !empty(p) && !(isShrinkable(p) && empty(p.shrink)),
	);
	const last = shown.length - 1;
	return (
		<div
			className={cn(
				"text-fg-3 text-meta mt-px flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap",
				className,
			)}
		>
			{shown.map((p, i) => {
				const shrinks = isShrinkable(p) || (i === last && !isKept(p));
				const node = isShrinkable(p)
					? p.shrink
					: isKept(p)
						? p.keep
						: (p as ReactNode);
				return (
					<span
						className={cn(
							"flex items-center gap-2",
							shrinks ? "min-w-0 shrink truncate" : "shrink-0",
						)}
						// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
						key={i}
					>
						{i > 0 && <span aria-hidden="true">·</span>}
						{shrinks ? <span className="truncate">{node}</span> : node}
					</span>
				);
			})}
		</div>
	);
}

export { IconTile, RowBar } from "./lead";
