"use client";

import { CheckIcon } from "lucide-react";
import type * as React from "react";

import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "~/components/ui/command";
import { cn } from "~/lib/utils";
import { pickerFilter } from "./match";

const coarse = () =>
	typeof window !== "undefined" &&
	window.matchMedia("(pointer: coarse)").matches;

/**
 * The shared body of the list pickers: a Find field (type to filter, case
 * and accent blind), arrow keys and Enter (cmdk), and an empty line. On
 * touch the field does not take focus, so no keyboard pops up unasked.
 */
export function PickerList(props: {
	label: string;
	placeholder: string;
	empty: string;
	search?: string;
	onSearch?: (q: string) => void;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Command
			className={cn("bg-transparent", props.className)}
			filter={pickerFilter}
			label={props.label}
		>
			<CommandInput
				aria-label={props.placeholder}
				autoFocus={!coarse()}
				onValueChange={props.onSearch}
				placeholder={props.placeholder}
				value={props.search}
			/>
			<CommandList className="max-h-80">
				<CommandEmpty className="py-6 text-center text-fg-2 text-small">
					{props.empty}
				</CommandEmpty>
				{props.children}
			</CommandList>
		</Command>
	);
}

export function PickerGroup(props: {
	heading: string;
	children: React.ReactNode;
}) {
	return (
		<CommandGroup
			className="[&_[cmdk-group-heading]]:text-fg-2 [&_[cmdk-group-heading]]:text-small"
			heading={props.heading}
		>
			{props.children}
		</CommandGroup>
	);
}

/** One option: identity in the 24px lead slot, the name, a check when chosen. */
export function PickerItem(props: {
	value: string;
	keywords: string[];
	lead: React.ReactNode;
	selected: boolean;
	onSelect: () => void;
	children: React.ReactNode;
	selectedLabel: string;
}) {
	return (
		<CommandItem
			className="h-row gap-2 rounded-ctl px-2 text-body data-[selected=true]:bg-raised"
			data-chosen={props.selected || undefined}
			keywords={props.keywords}
			onSelect={props.onSelect}
			value={props.value}
		>
			<span
				aria-hidden="true"
				className="flex size-6 shrink-0 items-center justify-center"
			>
				{props.lead}
			</span>
			<span className="min-w-0 flex-1 truncate">{props.children}</span>
			{props.selected ? (
				<>
					<CheckIcon aria-hidden="true" className="text-brand" />
					<span className="sr-only">{props.selectedLabel}</span>
				</>
			) : null}
		</CommandItem>
	);
}
