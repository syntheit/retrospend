"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";

import { cn } from "~/lib/utils";

function TooltipProvider({
	delayDuration = 0,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delayDuration={delayDuration}
			{...props}
		/>
	);
}

function Tooltip({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return (
		<TooltipProvider>
			<TooltipPrimitive.Root data-slot="tooltip" {...props} />
		</TooltipProvider>
	);
}

function TooltipTrigger({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
	className,
	sideOffset = 0,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				className={cn(
					"fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in text-balance rounded-md border bg-popover px-3 py-1.5 text-popover-foreground text-xs shadow-md data-[state=closed]:animate-out",
					className,
				)}
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				{...props}
			>
				{children}
				<TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] border-r border-b bg-popover" />
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	);
}

/**
 * The design's tooltip (one clause): the name of an icon-only control, the
 * rate behind a foreign amount, a face's name. Inverted fill (fg on bg), 12px,
 * no arrow, and only a fade. Radix opens it on hover and keyboard focus, not
 * on touch, so nothing a person needs to finish a task may live here.
 * TooltipContent keeps the old look for today's pages.
 */
function Tip({
	content,
	children,
	side = "top",
	className,
}: {
	content: React.ReactNode;
	/** The trigger: one element that takes a ref (a button, a face). */
	children: React.ReactElement;
	side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
	className?: string;
}) {
	return (
		<Tooltip>
			<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					className={cn(
						"fade-in-0 data-[state=closed]:fade-out-0 z-50 max-w-56 animate-in rounded-ctl bg-fg px-2 py-1 text-bg text-meta duration-(--t-state) data-[state=closed]:animate-out",
						className,
					)}
					data-slot="tip"
					side={side}
					sideOffset={4}
				>
					{content}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</Tooltip>
	);
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Tip };
