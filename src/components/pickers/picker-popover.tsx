"use client";

import type * as React from "react";

import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { Sheet } from "~/components/ui/sheet";
import { useIsMobile } from "~/hooks/use-mobile";

/**
 * Where a picker opens: an anchored popover on desktop, a medium sheet on
 * phones (a nested sheet when the trigger is inside a sheet, so its Cancel
 * returns to the parent). The trigger must forward its ref (a Button).
 */
export function PickerPopover(props: {
	title: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: React.ReactElement<{ onClick?: () => void }>;
	children: React.ReactNode;
}) {
	const phone = useIsMobile();
	if (phone)
		return (
			<>
				<PopoverlessTrigger onOpen={() => props.onOpenChange(true)}>
					{props.trigger}
				</PopoverlessTrigger>
				<Sheet
					detent="medium"
					footer={false}
					onOpenChange={props.onOpenChange}
					open={props.open}
					title={props.title}
				>
					{props.children}
				</Sheet>
			</>
		);
	return (
		<Popover onOpenChange={props.onOpenChange} open={props.open}>
			<PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
			<PopoverContent
				align="start"
				aria-label={props.title}
				className="w-72 rounded-panel bg-surface p-2 shadow-menu"
			>
				{props.children}
			</PopoverContent>
		</Popover>
	);
}

/** On phones the trigger only opens the sheet. */
function PopoverlessTrigger({
	children,
	onOpen,
}: {
	children: React.ReactElement<{ onClick?: () => void }>;
	onOpen: () => void;
}) {
	return (
		<span className="contents" onClickCapture={onOpen}>
			{children}
		</span>
	);
}
