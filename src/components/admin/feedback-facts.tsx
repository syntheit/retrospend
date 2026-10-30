"use client";

import type { ReactNode } from "react";

/** Label and value pairs; a pair without a value is left out. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
	return (
		<dl className="divide-line text-body divide-y">
			{rows
				.filter(([, value]) => value != null && value !== "")
				.map(([label, value]) => (
					<div
						className="flex items-baseline justify-between gap-3 py-2"
						key={label}
					>
						<dt className="text-fg-2 shrink-0">{label}</dt>
						<dd className="text-fg min-w-0 text-right break-words">{value}</dd>
					</div>
				))}
		</dl>
	);
}

export function Stack({ children }: { children: string }) {
	return (
		<pre className="bg-raised text-fg-2 text-meta rounded-ctl overflow-x-auto p-3 font-mono whitespace-pre-wrap break-words">
			{children}
		</pre>
	);
}
