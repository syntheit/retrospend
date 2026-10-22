import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { useTranslations } from "next-intl";
import type * as React from "react";

import { STATUS, type StatusKind, toneOf } from "~/components/ui/status-map";
import { cn } from "~/lib/utils";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border font-medium transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none",
	{
		variants: {
			variant: {
				default:
					"border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
				secondary:
					"border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
				destructive:
					"border-transparent bg-destructive text-destructive-foreground focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
				outline:
					"text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
			},
			size: {
				default: "px-2 py-0.5 text-xs [&>svg]:size-3",
				sm: "px-1.5 py-0 text-[10px] [&>svg]:size-2.5",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface BadgeProps
	extends React.ComponentProps<"span">,
		VariantProps<typeof badgeVariants> {
	asChild?: boolean;
}

function Badge(props: BadgeProps | StatusBadgeProps) {
	if ("status" in props) return <StatusBadge {...props} />;
	const { className, variant, size, asChild = false, ...rest } = props;
	const Comp = asChild ? Slot : "span";

	return (
		<Comp
			className={cn(badgeVariants({ variant, size }), className)}
			data-slot="badge"
			{...rest}
		/>
	);
}

/**
 * The design's badge: a status kind from the one status map (R5) drawn as a
 * pill, for places where a dot would get lost (a table cell, next to a sheet
 * title). The word comes from the map and the fill follows its tone. Never a
 * count, never money. Today's pages pass `variant` and keep the old look.
 */
export interface StatusBadgeProps {
	status: StatusKind;
	/** A more specific word than the map's ("Overdue since Oct 3"). */
	label?: string;
	className?: string;
}

function StatusBadge({ status, label, className }: StatusBadgeProps) {
	// next-intl's useTranslations works in server and client components alike.
	const t = useTranslations("kit.status");
	const tone = toneOf(status);
	return (
		<span
			className={cn(
				"inline-flex h-6 w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-chip px-2 font-medium text-meta",
				tone.pill,
				tone.text,
				className,
			)}
			data-slot="badge"
			data-status={status}
		>
			<span
				aria-hidden="true"
				className={cn("size-2 shrink-0 rounded-full", tone.dot)}
			/>
			{label ?? t(STATUS[status].word)}
		</span>
	);
}

export { Badge, badgeVariants };
