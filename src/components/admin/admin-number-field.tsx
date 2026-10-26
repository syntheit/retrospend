"use client";

import { useEffect, useState } from "react";
import { Input } from "~/components/ui/input";

/** One whole-number field that saves on blur or Enter when the value is valid. */
export function NumberField({
	id,
	label,
	min,
	max,
	value,
	disabled,
	onSave,
}: {
	id: string;
	label: string;
	min: number;
	max?: number;
	value: number | undefined;
	disabled: boolean;
	onSave: (value: number) => void;
}) {
	const [draft, setDraft] = useState("");
	useEffect(() => {
		if (value != null) setDraft(String(value));
	}, [value]);
	const save = () => {
		const n = Number.parseInt(draft, 10);
		if (
			!Number.isNaN(n) &&
			n >= min &&
			(max == null || n <= max) &&
			n !== value
		)
			onSave(n);
	};
	return (
		<Input
			aria-label={label}
			className="h-ctl w-32 text-right tabular-nums"
			disabled={disabled}
			id={id}
			max={max}
			min={min}
			onBlur={save}
			onChange={(e) => setDraft(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					save();
				}
			}}
			type="number"
			value={draft}
		/>
	);
}
