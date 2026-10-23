"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import {
	draftFromMinor,
	type MoneyInputResult,
} from "@retrospend/domain/parse";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PersonIdentityDTO } from "~/features/people/types";
import { api, type RouterInputs } from "~/trpc/react";

type Direction = "outgoing" | "incoming";
export type RecordInput = RouterInputs["settlement"]["paymentPreview"];
type Claim = {
	paymentId: string;
	amount: number;
	currency: string;
	paidOn: string;
};

/** Waits until the value stops changing, so typing previews once, not per key. */
function useSettled<T>(value: T, ms = 300): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const id = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(id);
	}, [value, ms]);
	return settled;
}

const EMPTY: MoneyInputResult = { ok: false, error: "empty" };

/**
 * The Settle up sheet's state (MONEY-MOVES §1, R30): the context read, the
 * choices, and the preview, which is payment.record run as a dry run. The
 * amount starts empty; Everything and the currency parts fill the server's
 * figure, and a part also limits the payment to that currency (Apply to).
 * A new rate type refills them. Nothing here adds, converts or rounds.
 */
export function useSettle(
	person: PersonIdentityDTO | null,
	scope?: string | null,
	/** After Record: nothing reads or previews again (the sheet shows what changed). */
	frozen = false,
) {
	const locale = useLocale();
	const [direction, setDirection] = useState<Direction | null>(null);
	const [currency, setCurrency] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [result, setResult] = useState<MoneyInputResult>(EMPTY);
	const [everything, setEverything] = useState(false);
	/** The currency part a fill chip chose: the payment applies to it only. */
	const [part, setPart] = useState<string | null>(null);
	const [rateType, setRateType] = useState<string | null>(null);
	const [method, setMethod] = useState<string | null>(null);
	const [paidOn, setPaidOn] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [allowOverpay, setAllowOverpay] = useState(false);
	const [different, setDifferent] = useState(false);
	const [claim, setClaim] = useState<Claim | null>(null);
	const claimId = claim?.paymentId ?? null;

	// Keyed on the identity, not the object: a caller may pass a fresh object
	// each render, and a new ref would restart the preview forever.
	const type = person?.type;
	const id = person?.id;
	const ref = useMemo(
		() => (type && id ? { participantType: type, participantId: id } : null),
		[type, id],
	);
	const ctx = api.people.settleContext.useQuery(
		{
			person: ref ?? { participantType: "user", participantId: "-" },
			direction: direction ?? undefined,
			currency: currency ?? undefined,
			rateType,
			...(scope === undefined ? {} : { scope }),
		},
		{ enabled: ref !== null && !frozen, placeholderData: keepPreviousData },
	);
	const c = ctx.data;
	const minor = result.ok ? result.minor : null;
	const hasAmount = everything || (minor !== null && minor > 0);

	const input: RecordInput | null = useMemo(() => {
		if (!ref || !c || !hasAmount || minor === null) return null;
		// Same payment: confirm their record as they made it; only what you
		// picked yourself (a date, a method) or a different amount in their
		// currency changes it (the server checks again).
		const confirming = claim && !different ? claim : null;
		const sameCurrency = !confirming || confirming.currency === c.currency;
		return {
			person: ref,
			direction: c.direction,
			currency: confirming ? confirming.currency : c.currency,
			// Everything sends the amount the sheet showed, so Record writes
			// exactly what the preview said even if a rate moves meanwhile.
			amount: sameCurrency ? fromMinor({ minor, currency: c.currency }) : null,
			rateType,
			paymentMethod: method,
			paidOn: paidOn ?? (confirming ? null : c.today),
			note: note.trim() || null,
			...(part
				? {
						applyTo: [
							{ ...(scope === undefined ? {} : { scope }), currency: part },
						],
					}
				: scope === undefined
					? {}
					: { applyTo: [{ scope }] }),
			allowOverpay,
			// The server refuses it if Everything moved since (then we reload it).
			...(everything && !confirming ? { everything: true } : {}),
			...(confirming ? { matchClaimId: confirming.paymentId } : {}),
			...(different ? { differentPayment: true } : {}),
		};
	}, [
		ref,
		c,
		hasAmount,
		everything,
		minor,
		rateType,
		method,
		paidOn,
		note,
		scope,
		allowOverpay,
		claim,
		different,
		part,
	]);
	const settled = useSettled(input);
	const preview = api.settlement.paymentPreview.useQuery(
		settled as RecordInput,
		{
			enabled: settled !== null && !frozen,
			// A refusal (the balance moved) is an answer, not a network blip.
			retry: false,
			placeholderData: keepPreviousData,
		},
	);
	const value = settled && preview.data ? preview.data.value : null;

	// Everything moved (a new expense, a payment): read the context again; the
	// refill below then puts the new figure in the amount.
	// Once per refused input, never in a loop: refetch is not a stable function.
	const stale =
		!frozen && preview.error?.data?.code === "CONFLICT" ? settled : null;
	const reload = useRef(ctx.refetch);
	reload.current = ctx.refetch;
	useEffect(() => {
		if (stale) void reload.current();
	}, [stale]);

	// "Same payment?": the receiver's amount matches a claim; confirm it by default.
	useEffect(() => {
		if (
			value &&
			!value.recorded &&
			value.reason === "matches_claim" &&
			value.match
		)
			setClaim(value.match.claim);
	}, [value]);

	// A new rate type (or fresh balances) moves Everything and the parts: the
	// filled amount follows the server's figure, never a stale one.
	const refill = everything
		? c?.everything
		: part
			? c?.parts.find((p) => p.currency === part)?.full
			: null;
	useEffect(() => {
		if (!refill) return;
		setText(draftFromMinor(refill.minor, locale, refill.currency));
		setResult({ ok: true, minor: refill.minor, expression: false });
	}, [refill?.minor, refill?.currency, locale]);

	/** Every change of what is paid starts the questions over. */
	const reset = () => {
		setAllowOverpay(false);
		setClaim(null);
		setDifferent(false);
	};

	return {
		ctx: c,
		ctxError: ctx.error,
		loading: ctx.isLoading,
		text,
		everything,
		part,
		rateType,
		method,
		paidOn: paidOn ?? c?.today ?? null,
		note,
		allowOverpay,
		/** The claim the amount matched, kept while the choice stands. */
		claim,
		claimId: different ? null : claimId,
		input: input && settled === input ? input : null,
		preview: settled === input ? (preview.data ?? null) : null,
		previewing: preview.isFetching || settled !== input,
		previewError: preview.error,
		setText: (next: string, parsed: MoneyInputResult) => {
			setText(next);
			setPart(null);
			setResult(parsed);
			setEverything(false);
			reset();
		},
		/** Fills a server amount: Everything, one currency part, or a plain amount. */
		fill: (
			amount: { minor: number; currency: string },
			all: boolean,
			partCurrency: string | null = null,
		) => {
			setText(draftFromMinor(amount.minor, locale, amount.currency));
			setResult({ ok: true, minor: amount.minor, expression: false });
			setEverything(all);
			setPart(partCurrency);
			reset();
		},
		setDirection: (d: Direction) => {
			setDirection(d);
			setPart(null);
			setText("");
			setResult(EMPTY);
			setEverything(false);
			reset();
		},
		setCurrency: (code: string) => {
			setCurrency(code);
			setPart(null);
			setText("");
			setResult(EMPTY);
			setEverything(false);
			reset();
		},
		setRateType,
		setMethod,
		setPaidOn,
		setNote,
		overpayOk: () => setAllowOverpay(true),
		setDifferent,
	};
}

export type SettleState = ReturnType<typeof useSettle>;
