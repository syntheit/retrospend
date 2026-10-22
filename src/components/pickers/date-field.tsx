"use client";

import * as React from "react";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { type DigitOrder, type IsoDate, parseTypedDate } from "./dates";

/**
 * A typed date: shows the day in the locale's short form and reads ISO or
 * the locale's digit order back on blur or Enter. Unreadable text marks the
 * field invalid and keeps the last good value.
 */
export function DateField(props: {
	id: string;
	label: string;
	placeholder: string;
	value: IsoDate | null;
	order: DigitOrder;
	display: (iso: IsoDate) => string;
	onChange: (iso: IsoDate | null) => void;
}) {
	const shown = props.value ? props.display(props.value) : "";
	const [text, setText] = React.useState(shown);
	const [invalid, setInvalid] = React.useState(false);

	React.useEffect(() => {
		setText(shown);
		setInvalid(false);
	}, [shown]);

	const commit = () => {
		if (text === shown) return;
		const parsed = parseTypedDate(text, props.order);
		if (parsed === null) {
			setInvalid(true);
			return;
		}
		setInvalid(false);
		props.onChange(parsed === "" ? null : parsed);
	};

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-1">
			<Label className="text-fg-2 text-small" htmlFor={props.id}>
				{props.label}
			</Label>
			<Input
				aria-invalid={invalid || undefined}
				autoComplete="off"
				className="h-ctl"
				id={props.id}
				onBlur={commit}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key !== "Enter") return;
					commit();
					// Plain Enter only reads the date; Cmd or Ctrl+Enter still submits the sheet.
					if (!e.metaKey && !e.ctrlKey) e.preventDefault();
				}}
				placeholder={props.placeholder}
				value={text}
			/>
		</div>
	);
}
