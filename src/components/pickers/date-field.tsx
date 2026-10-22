"use client";

import * as React from "react";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { IsoDate } from "./dates";

/**
 * A typed date: at rest it shows the kit's medium date ("Oct 5, 2026"); on
 * focus it switches to the numeric form to edit. Blur or Enter reads either
 * form back. Unreadable text marks the field invalid and keeps the last
 * good value.
 */
export function DateField(props: {
	id: string;
	label: string;
	placeholder: string;
	value: IsoDate | null;
	/** At rest. */
	display: (iso: IsoDate) => string;
	/** While focused. */
	edit: (iso: IsoDate) => string;
	read: (text: string) => IsoDate | "" | null;
	onChange: (iso: IsoDate | null) => void;
}) {
	const [focused, setFocused] = React.useState(false);
	const shown = props.value
		? (focused ? props.edit : props.display)(props.value)
		: "";
	const [text, setText] = React.useState(shown);
	const [invalid, setInvalid] = React.useState(false);

	React.useEffect(() => {
		setText(shown);
		setInvalid(false);
	}, [shown]);

	const commit = () => {
		if (text === shown) return;
		const parsed = props.read(text);
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
				onBlur={() => {
					commit();
					setFocused(false);
				}}
				onChange={(e) => setText(e.target.value)}
				onFocus={() => setFocused(true)}
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
