"use client";

import { Money } from "~/components/money/money";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";

type Amount = { minor: number; currency: string };

/** The To assign pool has no envelope id; the select needs a value for it. */
export const POOL = "__pool";

export type Place = {
	/** An envelope id, or POOL. */
	value: string;
	name: string;
	/** What it holds (its Left, or To assign): the server's figure. */
	amount: Amount | null;
	/** A word under the name: "Bill due Nov 5". */
	note?: string;
	/** Holds nothing to take (an Add money source with no Left). */
	disabled?: boolean;
};

/**
 * Pick where money comes from or goes to: To assign or an envelope, each with
 * what it holds. The list order is the server's (Cover sources: To assign,
 * then Monthly by Left, then Savings, then Bills last).
 */
export function EnvelopeSelect({
	label,
	value,
	onChange,
	places,
	placeholder,
}: {
	label: string;
	value: string | null;
	onChange: (value: string) => void;
	places: readonly Place[];
	placeholder?: string;
}) {
	return (
		<Select kit onValueChange={onChange} value={value ?? undefined}>
			<SelectTrigger aria-label={label} className="w-full">
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{places.map((p) => (
					<SelectItem disabled={p.disabled} key={p.value} value={p.value}>
						<span className="flex min-w-0 flex-col">
							<span className="truncate">{p.name}</span>
							{p.note ? (
								<span className="text-fg-3 text-meta">{p.note}</span>
							) : null}
						</span>
						{p.amount ? (
							<span className="text-fg-3 text-meta ml-auto">
								<Money value={p.amount} />
							</span>
						) : null}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
