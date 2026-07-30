"use client";

import { cn } from "~/lib/utils";

/* ── Segmented toggle (pill-style, matches dashboard filter tabs) ── */

export function SegmentedToggle<T extends string>({
	options,
	value,
	onChange,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex gap-1">
			{options.map((opt) => (
				<button
					className={cn(
						"cursor-pointer rounded-full px-3 py-1 font-medium text-xs transition-colors",
						value === opt.value
							? "bg-primary text-primary-foreground"
							: "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
					)}
					key={opt.value}
					onClick={() => onChange(opt.value)}
					type="button"
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}
