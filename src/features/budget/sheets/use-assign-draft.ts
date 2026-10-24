"use client";

import { draftFromMinor } from "@retrospend/domain/parse";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import { minorOf } from "./amount-cell";
import { newId } from "./use-write";

type FillLines = RouterOutputs["envelope"]["fillFromTargets"]["lines"];
export type AssignInput = RouterInputs["envelope"]["assign"];
type Texts = Record<string, string>;

/**
 * The amounts typed on the assign sheet, one text per envelope. They start
 * from the server's fill from targets once it arrives (unless you already
 * typed), and `items` is the write they make: only envelopes with an amount
 * above zero, each with an id of its own so a retry is a no-op. `invalid`
 * names a text that cannot be read (the dry run waits until it is fixed).
 */
export function useAssignDraft({
	currency,
	month,
	lines,
}: {
	currency: string;
	month: number | null;
	lines: FillLines | undefined;
}) {
	const locale = useLocale();
	const [texts, setTexts] = useState<Texts>({});
	const [typed, setTyped] = useState(false);
	const [batchId] = useState(newId);
	const ids = useRef(new Map<string, string>());

	const fromLines = useCallback(
		(source: FillLines): Texts => {
			const sums = new Map<string, number>();
			for (const l of source)
				sums.set(l.envelopeId, (sums.get(l.envelopeId) ?? 0) + l.amount.minor);
			const out: Texts = {};
			for (const [id, minor] of sums)
				if (minor > 0) out[id] = draftFromMinor(minor, locale, currency);
			return out;
		},
		[locale, currency],
	);

	useEffect(() => {
		if (typed || !lines || !currency) return;
		setTexts(fromLines(lines));
	}, [lines, typed, currency, fromLines]);

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
