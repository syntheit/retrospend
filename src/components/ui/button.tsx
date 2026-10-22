import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"border border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
				outline:
					"border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80",
				ghost:
					"hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				sm: "h-8 gap-1.5 rounded-lg px-3 has-[>svg]:px-2.5",
				lg: "h-10 rounded-lg px-6 has-[>svg]:px-4",
				icon: "size-9",
				"icon-sm": "size-8",
				"icon-lg": "size-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

/**
 * The design's button (GUIDELINE §4 Buttons), chosen with `kind`. Every
 * control in a row shares one height: `ctl` (32, 36 on phone) or all `sm`
 * (28). Today's pages still pass `variant` and get the old look until the
 * switch-over moves them to `kind`.
 */
const kindVariants = cva(
	"relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-ctl border border-transparent font-medium transition-colors duration-(--t-state) ease-land focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-45 aria-busy:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			kind: {
				primary: "bg-brand text-brand-fg can-hover:hover:bg-brand-hover",
				secondary:
					"border-line-strong bg-surface text-fg can-hover:hover:bg-raised",
				ghost: "text-fg-2 can-hover:hover:bg-raised can-hover:hover:text-fg",
				danger: "bg-danger text-danger-fg can-hover:hover:bg-danger-hover",
			},
			size: {
				ctl: "h-ctl px-3 text-body",
				sm: "h-ctl-sm px-3 text-small",
			},
			icon: { true: "px-0", false: "" },
		},
		compoundVariants: [
			{ size: "ctl", icon: true, className: "w-ctl" },
			{ size: "sm", icon: true, className: "w-ctl-sm" },
		],
		defaultVariants: { kind: "secondary", size: "ctl", icon: false },
	},
);

type Kind = NonNullable<VariantProps<typeof kindVariants>["kind"]>;

/** The spinner keeps the label's color while the label itself goes clear. */
const SPINNER: Record<Kind, string> = {
	primary: "text-brand-fg",
	secondary: "text-fg-2",
	ghost: "text-fg-2",
	danger: "text-danger-fg",
};
type LegacySize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

/**
 * One props type, not a union, so wrappers can spread
 * React.ComponentProps<typeof Button>. With `kind`, `size` is ctl or sm
 * (anything else reads as ctl) and `variant` is ignored.
 */
type ButtonProps = React.ComponentProps<"button"> & {
	asChild?: boolean;
	variant?: VariantProps<typeof buttonVariants>["variant"];
	size?: LegacySize | "ctl";
	kind?: Kind;
	/** Icon-only (with `kind`): square, needs an aria-label and a Tooltip (UI-131). */
	icon?: boolean;
	/** With `kind`: keeps the width, swaps the label for a spinner, blocks presses. */
	loading?: boolean;
};

function Button({
	className,
	variant = "default",
	size,
	asChild = false,
	kind,
	icon = false,
	loading = false,
	...props
}: ButtonProps) {
	if (kind)
		return (
			<KindButton
				asChild={asChild}
				className={className}
				icon={icon}
				kind={kind}
				loading={loading}
				size={size === "sm" ? "sm" : "ctl"}
				{...props}
			/>
		);
	const legacySize = size === "ctl" || size == null ? "default" : size;
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			className={cn(buttonVariants({ variant, size: legacySize, className }))}
			data-size={legacySize}
			data-slot="button"
			data-variant={variant}
			{...props}
		/>
	);
}

/**
 * A busy button swallows the press. Enter and Space on a button arrive as a
 * click too, so this covers pointer and keyboard alike, and preventDefault
 * also stops a submit button from submitting its form.
 */
function guardBusy<E extends { preventDefault: () => void }>(
	busy: boolean,
	onClick?: (e: E) => void,
): ((e: E) => void) | undefined {
	return busy ? (e) => e.preventDefault() : onClick;
}

function KindButton({
	className,
	kind,
	size,
	icon,
	loading,
	asChild,
	children,
	type,
	onClick,
	...rest
}: React.ComponentProps<"button"> & {
	asChild: boolean;
	kind: Kind;
	size: "ctl" | "sm";
	icon: boolean;
	loading: boolean;
}) {
	const t = useTranslations("kit.button");
	const Comp = asChild ? Slot : "button";
	// Slot takes a single child, so a link styled as a button never spins.
	const busy = loading && !asChild;
	return (
		<Comp
			aria-busy={busy || undefined}
			className={cn(
				kindVariants({ kind, size, icon }),
				busy && "text-transparent can-hover:hover:text-transparent",
				className,
			)}
			data-kind={kind}
			data-slot="button"
			onClick={guardBusy(busy, onClick)}
			type={asChild ? undefined : (type ?? "button")}
			{...rest}
		>
			{children}
			{busy && (
				<>
					<LoaderCircle
						aria-hidden="true"
						className={cn("absolute size-3.5! animate-spin", SPINNER[kind])}
					/>
					<span className="sr-only">{t("loading")}</span>
				</>
			)}
		</Comp>
	);
}

export { Button, buttonVariants, guardBusy, kindVariants };
