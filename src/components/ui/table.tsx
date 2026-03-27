"use client";

import type * as React from "react";

import { cn } from "~/lib/utils";

function Table({
	className,
	wrapperClassName,
	...props
}: React.ComponentProps<"table"> & { wrapperClassName?: string }) {
	return (
		<div className={cn("relative w-full overflow-auto", wrapperClassName)}>
			<table
				className={cn("w-full caption-bottom text-sm", className)}
				data-slot="table"
				{...props}
			/>
		</div>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return (
		<thead
			className={cn("sticky top-0 z-10 bg-muted/50 [&_tr]:border-b", className)}
			data-slot="table-header"
			{...props}
		/>
	);
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody
			className={cn("[&_tr:last-child]:border-0", className)}
			data-slot="table-body"
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			className={cn(
				"sticky bottom-0 z-10 border-t bg-muted/95 font-medium backdrop-blur-sm [&>tr]:last:border-b-0",
				className,
			)}
			data-slot="table-footer"
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			className={cn(
				"border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
				className,
			)}
			data-slot="table-row"
			{...props}
		/>
	);
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			className={cn(
				"h-10 whitespace-nowrap px-4 py-3 text-left align-middle font-medium text-muted-foreground text-sm [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			data-slot="table-head"
			{...props}
		/>
	);
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
	return (
		<td
			className={cn(
				"whitespace-nowrap px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			data-slot="table-cell"
			{...props}
		/>
	);
}

function TableCaption({
	className,
	...props
}: React.ComponentProps<"caption">) {
	return (
		<caption
			className={cn("mt-4 text-muted-foreground text-sm", className)}
			data-slot="table-caption"
			{...props}
		/>
	);
}

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	TableRow,
	TableCell,
	TableCaption,
};
