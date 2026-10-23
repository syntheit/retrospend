"use client";

import { Money } from "~/components/money/money";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import type { EntryCatalog } from "./shared-ui";

type Place = EntryCatalog["places"][number];

const NONE = "__none";

/**
 * Pick an account (with its currency and balance), or no account when
 * `none` is given: the move then touches no account (N75).
 */
export function PlaceSelect({
	places,
	value,
	onChange,
	label,
	none,
}: {
	places: readonly Place[];
	value: string | null;
	onChange: (id: string | null) => void;
	label: string;
	none?: string;
}) {
	return (
		<Select
			onValueChange={(v) => onChange(v === NONE ? null : v)}
			value={value ?? NONE}
		>
			<SelectTrigger aria-label={label} className="w-full">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{none ? (
					<>
						<SelectItem value={NONE}>{none}</SelectItem>
						<SelectSeparator />
					</>
				) : null}
				{places.map((p) => (
					<SelectItem key={p.id} value={p.id}>
						<span className="truncate">{p.name}</span>
						<span className="text-fg-3 text-meta">
							<Money value={p.balance} />
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
