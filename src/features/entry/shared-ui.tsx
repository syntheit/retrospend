"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { Money } from "~/components/money/money";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";

export type EntryCatalog = RouterOutputs["entry"]["catalog"];
export type RatePair = { unit: MoneyDTO; value: MoneyDTO };
export type MoneyDTO = { minor: number; currency: string };

/** What the sheets read once: categories, recents, places, the home currency. */
export function useEntryCatalog() {
	return api.entry.catalog.useQuery(undefined, { staleTime: 60_000 });
}

/** `value` after it has been still for `ms`: previews run on a pause, not every key. */
export function useSettled<T>(value: T, ms = 300): T {
	const [settled, setSettled] = useState(value);
	const key = JSON.stringify(value);
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialized value
	useEffect(() => {
		const t = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(t);
	}, [key, ms]);
	return settled;
}

/** A rate type's name; a type the rate table adds later reads as its key, capitalized. */
export function useRateTypeName() {
	const t = useTranslations("entry.rate.types");
	return (type: string | null | undefined) => {
		if (!type) return "";
		return t.has(type) ? t(type) : type.charAt(0).toUpperCase() + type.slice(1);
	};
}

/** "USD 1 = ARS 1,468 · Blue": both sides through the money formatter. */
export function RateLine({
	rate,
	type,
}: {
	rate: RatePair;
	type?: string | null;
}) {
	const name = useRateTypeName();
	return (
		<span className="tabular-nums">
			<Money cents={false} value={rate.unit} /> = <Money value={rate.value} />
			{type ? ` · ${name(type)}` : null}
		</span>
	);
}

/** A labeled field in the one column (label above the control). */
export function Field({
	label,
	htmlFor,
	children,
	error,
}: {
	label: string;
	htmlFor?: string;
	children: ReactNode;
	error?: string | null;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2">
			{htmlFor ? (
				<label className="font-medium text-fg-2 text-small" htmlFor={htmlFor}>
					{label}
				</label>
			) : (
				<span className="font-medium text-fg-2 text-small">{label}</span>
			)}
			{children}
			<FieldError text={error} />
		</div>
	);
}

export function FieldError({ text }: { text?: string | null }) {
	if (!text) return null;
	return (
		<span className="text-danger text-meta" role="alert">
			{text}
		</span>
	);
}
