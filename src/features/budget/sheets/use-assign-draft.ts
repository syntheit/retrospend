"use client";

import { draftFromMinor } from "@retrospend/domain/parse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { minorOf } from "~/components/money/money-cell";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import { newId } from "./use-write";

type FillTotals = RouterOutputs["envelope"]["fillFromTargets"]["totals"];
export type AssignInput = RouterInputs["envelope"]["assign"];
type Texts = Record<string, string>;

/**
 * The amounts typed on the assign sheet, one text per envelope. They start
 * from the server's fill from targets once it arrives (its total per
 * envelope, unless you already typed), and `items` is the write they make:
 * only envelopes with an amount above zero, each with an id of its own so a
 * retry is a no-op. `invalid` names a text that cannot be read (the dry run
 * waits until it is fixed).
 */
export function useAssignDraft({
	currency,
	month,
	totals,
}: {
	currency: string;
	month: number | null;
	totals: FillTotals | undefined;
}) {
	const locale = useMoneyLocale();
	const [texts, setTexts] = useState<Texts>({});
	const [typed, setTyped] = useState(false);
	const [batchId] = useState(newId);
	const ids = useRef(new Map<string, string>());

	const fromTotals = useCallback(
		(source: FillTotals): Texts => {
			const out: Texts = {};
			for (const row of source)
				if (row.amount.minor > 0)
					out[row.envelopeId] = draftFromMinor(
						row.amount.minor,
						locale,
						currency,
					);
			return out;
		},
		[locale, currency],
	);

	useEffect(() => {
		if (typed || !totals || !currency) return;
		setTexts(fromTotals(totals));
	}, [totals, typed, currency, fromTotals]);

	const set = useCallback((envelopeId: string, text: string) => {
		setTyped(true);
		setTexts((s) => ({ ...s, [envelopeId]: text }));
	}, []);
	const clear = useCallback(() => {
		setTyped(true);
		setTexts({});
	}, []);
	const refill = useCallback(() => {
		setTyped(false);
	}, []);

	const parsed = useMemo(() => {
		const items: AssignInput["items"] = [];
		const invalid = new Set<string>();
		for (const [envelopeId, text] of Object.entries(texts)) {
			if (text.trim() === "") continue;
			const minor = minorOf(text, locale, currency);
			if (minor === null) invalid.add(envelopeId);
			else if (minor > 0) {
				let id = ids.current.get(envelopeId);
				if (!id) {
					id = newId();
					ids.current.set(envelopeId, id);
				}
				items.push({ id, envelopeId, amountMinor: minor });
			}
		}
		return { items, invalid };
	}, [texts, locale, currency]);

	const input: AssignInput | null =
		month && parsed.items.length > 0 && parsed.invalid.size === 0
			? { batchId, month, mode: "add", items: parsed.items }
			: null;
	return { texts, set, clear, refill, input, invalid: parsed.invalid, batchId };
}
