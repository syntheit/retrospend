"use client";

import { useMemo } from "react";
import { DatePicker } from "~/components/ui/date-picker";
import { cn } from "~/lib/utils";

interface DateQuickSelectProps {
	date: Date;
	onSelect: (date: Date) => void;
}

function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export function DateQuickSelect({ date, onSelect }: DateQuickSelectProps) {
	const today = useMemo(() => new Date(), []);
	const yesterday = useMemo(() => {
		const d = new Date();
		d.setDate(d.getDate() - 1);
		return d;
	}, []);

	const chips: { label: string; date: Date }[] = [
		{ label: "Today", date: today },
		{ label: "Yesterday", date: yesterday },
	];

	return (
		<div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
			<div className="flex gap-1">
				{chips.map((chip) => {
					const isActive = isSameDay(date, chip.date);
					return (
						<button
							key={chip.label}
							type="button"
							onClick={() => onSelect(chip.date)}
							className={cn(
								"flex h-9 shrink-0 cursor-pointer items-center rounded-md border px-2 text-xs font-medium transition-colors",
								isActive
									? "border-primary bg-primary/20 text-primary"
									: "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
							)}
						>
							{chip.label}
						</button>
					);
				})}
			</div>
			<DatePicker
				date={date}
				onSelect={(d) => d && onSelect(d)}
				placeholder="Select date"
			/>
		</div>
	);
}
