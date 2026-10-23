"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/cn";
import { CONTROL_WIDTH } from "./setting-row";

export type SelectOption<T extends string> = {
	value: T;
	label: string;
	disabled?: boolean;
};

/** The kit Select at the settings column width and control height. */
export function SelectField<T extends string>({
	id,
	label,
	value,
	options,
	onChange,
	disabled,
}: {
	id: string;
	/** Accessible name when no visible label points at `id`. */
	label?: string;
	value: T;
	options: readonly SelectOption<T>[];
	onChange: (value: T) => void;
	disabled?: boolean;
}) {
	return (
		<Select
			disabled={disabled}
			onValueChange={(v) => onChange(v as T)}
			value={value}
		>
			<SelectTrigger
				aria-label={label}
				className={cn(CONTROL_WIDTH, "data-[size=default]:h-ctl")}
				id={id}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem disabled={o.disabled} key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
