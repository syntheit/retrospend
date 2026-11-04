"use client";

import { currencyName } from "@retrospend/domain/currency-names";
import { ChevronDown } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { CurrencyPicker } from "~/components/pickers/currency-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { Button } from "~/components/ui/button";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { cn } from "~/lib/cn";
import { CONTROL_MIN_WIDTH } from "../setting-row";

/**
 * A settings column currency control: the flag, the code and its name,
 * opening the CurrencyPicker. It is at least the column's select width and
 * grows to fit the name, so nothing is cut off; phones show the code only.
 */
export function CurrencyField({
	id,
	label,
	value,
	onChange,
	disabled,
	className,
	autoOpen,
}: {
	id: string;
	/** What the picker sets (its title and the trigger's name). */
	label: string;
	value: string;
	onChange: (code: string) => void;
	disabled?: boolean;
	/** Replaces the settings column's width (a form field fills its row). */
	className?: string;
	/** Opens the picker once on arrival (a link that asks for this choice). */
	autoOpen?: boolean;
}) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (autoOpen) setOpen(true);
	}, [autoOpen]);
	const locale = useLocale();
	const name = currencyName(value, locale, "");
	const trigger = (
		<Button
			aria-label={`${label}: ${value}`}
			className={cn(
				className ?? CONTROL_MIN_WIDTH,
				"max-w-full justify-between",
			)}
			disabled={disabled}
			id={id}
			kind="secondary"
		>
			<span className="flex min-w-0 items-center gap-2">
				<CurrencyFlag className="size-4" currencyCode={value} />
				<span className="truncate">
					{value}
					{name && <span className="text-fg-2 max-md:hidden"> · {name}</span>}
				</span>
			</span>
			<ChevronDown aria-hidden="true" className="text-fg-3" />
		</Button>
	);
	return (
		<PickerPopover
			onOpenChange={setOpen}
			open={open}
			title={label}
			trigger={trigger}
		>
			<CurrencyPicker
				onChange={(code) => {
					setOpen(false);
					onChange(code);
				}}
				value={value}
			/>
		</PickerPopover>
	);
}
