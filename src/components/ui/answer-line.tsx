"use client";

import { Fragment } from "react";
import { cn } from "~/lib/utils";

export type AnswerPart = {
	id: string;
	text: string;
	/** An unset answer reads in the attention color. */
	tone?: "attention";
	/** Spoken name when the text alone is not enough. */
	label?: string;
	onSelect: () => void;
};

/**
 * AnswerLine (composer design D): the answers so far as plain
 * text joined by " · ". It wraps (two lines on a phone) and each part is a
 * button that opens its panel.
 */
export function AnswerLine({
	parts,
	className,
}: {
	parts: readonly AnswerPart[];
	className?: string;
}) {
	return (
		<p className={cn("text-body text-fg max-md:line-clamp-2", className)}>
			{parts.map((part, i) => (
				<Fragment key={part.id}>
					{i > 0 ? (
						<span aria-hidden="true" className="text-fg-3">
							{" · "}
						</span>
					) : null}
					<button
						aria-label={part.label}
						className={cn(
							"rounded-ctl focus-visible:outline-brand can-hover:hover:underline cursor-pointer text-left underline-offset-4 transition-colors duration-(--t-state) focus-visible:outline-2 focus-visible:outline-offset-2",
							part.tone === "attention" ? "text-attention-text" : "text-fg",
						)}
						onClick={part.onSelect}
						type="button"
					>
						{part.text}
					</button>
				</Fragment>
			))}
		</p>
	);
}
