import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * Settings rows (mockup .srows/.srow): a label with an optional meta line on
 * the left, the control on the right, hairlines between rows. Flat on
 * desktop, a surface group on phones like every phone list (R13).
 */
export function SettingRows({
	children,
	className,
	label,
}: {
	children: ReactNode;
	className?: string;
	/** Accessible name when the rows have no heading of their own. */
	label?: string;
}) {
	return (
		<ul
			aria-label={label}
			className={cn(
				"flex flex-col *:border-line *:border-t *:first:border-t-0 max-md:rounded-panel max-md:border max-md:border-line max-md:bg-surface max-md:px-4",
				className,
			)}
		>
			{children}
		</ul>
	);
}

export function SettingRow({
	label,
	labelFor,
	meta,
	children,
	className,
}: {
	label: ReactNode;
	/** The control's id, so the label names it. */
	labelFor?: string;
	meta?: ReactNode;
	/** The control: a switch, a select or row buttons (secondary, sm). */
	children?: ReactNode;
	className?: string;
}) {
	const Label = labelFor ? "label" : "div";
	return (
		<li
			className={cn(
				"flex min-h-13 items-center gap-3 py-2 max-md:flex-wrap",
				className,
			)}
		>
			{/* On phones a long row of buttons wraps under the label instead of squeezing it. */}
			<div className="min-w-0 flex-1 max-md:basis-1/2">
				<Label className="block text-body text-fg" htmlFor={labelFor}>
					{label}
				</Label>
				{meta != null && meta !== "" && (
					<div className="mt-1 text-fg-3 text-meta">{meta}</div>
				)}
			</div>
			{children != null && (
				<div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 md:max-w-3/5">
					{children}
				</div>
			)}
		</li>
	);
}

/** A group heading inside a section (Money, Display, Defaults). */
export function SettingGroup({
	title,
	first = false,
	children,
}: {
	title: string;
	first?: boolean;
	children: ReactNode;
}) {
	return (
		<div className={first ? undefined : "mt-6"}>
			<h3 className="mb-1 font-semibold text-fg-2 text-small">{title}</h3>
			{children}
		</div>
	);
}

/** One width for every select-like control in a settings column (GUIDELINE §5). */
export const CONTROL_WIDTH = "w-50 max-w-full max-md:w-37.5";

/** The same width as a floor, for a control whose text must not be cut (currency). */
export const CONTROL_MIN_WIDTH = "min-w-50 max-md:min-w-37.5";

/**
 * A link in a settings row (mockup .link, GUIDELINE §2.1 accent-strong as
 * text), drawn like the kit Section's "See all" link.
 */
export const TEXT_LINK =
	"inline-flex items-center gap-1 rounded-ctl font-medium text-accent-strong text-small focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 can-hover:hover:underline";
