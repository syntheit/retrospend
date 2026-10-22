"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";
import { createContext, useContext, useLayoutEffect, useRef } from "react";

import { cn } from "~/lib/utils";

type ListVariant = "pill" | "line";
const ListVariantContext = createContext<ListVariant>("pill");

function Tabs({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return (
		<TabsPrimitive.Root
			className={cn("flex flex-col gap-2", className)}
			data-slot="tabs"
			{...props}
		/>
	);
}

/** The selected tab: Radix marks it with data-state, PageTabs with aria-current. */
const ACTIVE = '[data-state="active"], [aria-current="page"]';

/**
 * The one underline indicator of a tab row (R24). It sits on the selected
 * tab without motion on first paint and on resize, and slides (220ms,
 * ease-land) when the selection changes. It also tells the tabs root which
 * way the selection moved, so the entering pane comes from that side.
 * Reduced motion: --t-tab drops to 1ms and globals.css stops transforms, so
 * the indicator jumps and the pane only fades.
 */
function TabIndicator() {
	const ref = useRef<HTMLSpanElement>(null);

	useLayoutEffect(() => {
		const bar = ref.current;
		const list = bar?.parentElement;
		if (!bar || !list) return;
		const tabs = () =>
			Array.from(list.children).filter(
				(c): c is HTMLElement => c !== bar && c instanceof HTMLElement,
			);
		let index = tabs().findIndex((t) => t.matches(ACTIVE));

		const place = (animate: boolean) => {
			const on = list.querySelector<HTMLElement>(ACTIVE);
			bar.dataset.animate = String(animate);
			bar.style.width = on ? `${on.offsetWidth}px` : "0px";
			bar.style.transform = `translateX(${on?.offsetLeft ?? 0}px)`;
		};
		place(false);

		const moved = new MutationObserver(() => {
			const next = tabs().findIndex((t) => t.matches(ACTIVE));
			if (next === index) return;
			const root = list.closest<HTMLElement>('[data-slot="tabs"]');
			if (root && index >= 0)
				root.dataset.direction = next > index ? "forward" : "back";
			index = next;
			place(true);
		});
		moved.observe(list, {
			subtree: true,
			attributes: true,
			attributeFilter: ["data-state", "aria-current"],
		});
		const resized = new ResizeObserver(() => place(false));
		resized.observe(list);
		return () => {
			moved.disconnect();
			resized.disconnect();
		};
	}, []);

	return (
		<span
			aria-hidden="true"
			className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-chip bg-ds-accent data-[animate=true]:transition-[transform,width] data-[animate=true]:duration-(--t-tab) data-[animate=true]:ease-land"
			data-slot="tab-indicator"
			ref={ref}
		/>
	);
}

function TabsList({
	className,
	variant = "pill",
	children,
	...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
	/** `line`: the design's underline tabs (40 high, sliding accent indicator). */
	variant?: ListVariant;
}) {
	return (
		<ListVariantContext.Provider value={variant}>
			<TabsPrimitive.List
				className={cn(
					variant === "line"
						? "relative flex w-full items-stretch gap-6 overflow-x-auto border-line border-b [scrollbar-width:none]"
						: "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground",
					className,
				)}
				data-slot="tabs-list"
				data-variant={variant}
				{...props}
			>
				{children}
				{variant === "line" && <TabIndicator />}
			</TabsPrimitive.List>
		</ListVariantContext.Provider>
	);
}

/** Underline tab classes, shared with PageTabs. */
const lineTab =
	"relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap font-medium text-body text-fg-2 transition-colors duration-(--t-state) ease-land focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 can-hover:hover:text-fg";
const lineTabOn = "font-semibold text-fg can-hover:hover:text-fg";

function TabsTrigger({
	className,
	count,
	children,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
	/** A count after the label, in fg-3 (line tabs). */
	count?: number;
}) {
	const variant = useContext(ListVariantContext);
	return (
		<TabsPrimitive.Trigger
			className={cn(
				variant === "line"
					? cn(
							lineTab,
							"data-[state=active]:font-semibold data-[state=active]:text-fg",
						)
					: "inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 font-medium text-foreground text-sm transition-[color,box-shadow] focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:shadow-sm dark:text-muted-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			data-slot="tabs-trigger"
			{...props}
		>
			{children}
			{count != null && <TabCount n={count} />}
		</TabsPrimitive.Trigger>
	);
}

function TabCount({ n }: { n: number }) {
	return (
		<span className="font-normal text-fg-3 text-meta tabular-nums">{n}</span>
	);
}

function TabsContent({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return (
		<TabsPrimitive.Content
			className={cn(
				"flex-1 outline-none",
				// Only after a change: the pane enters from the side of the tab order.
				"in-data-[direction]:fade-in-0 in-data-[direction]:animate-in in-data-[direction]:duration-(--t-tab) in-data-[direction]:ease-land",
				"in-data-[direction=forward]:slide-in-from-right-3 in-data-[direction=back]:slide-in-from-left-3",
				className,
			)}
			data-slot="tabs-content"
			{...props}
		/>
	);
}

export {
	Tabs,
	TabsList,
	TabsTrigger,
	TabsContent,
	TabIndicator,
	TabCount,
	lineTab,
	lineTabOn,
};
