import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

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

function Badge({
	className,
	variant,
	size,
	asChild = false,
	...props
}: BadgeProps) {
	const Comp = asChild ? Slot : "span";

	return (
		<Comp
			className={cn(badgeVariants({ variant, size }), className)}
			data-slot="badge"
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
