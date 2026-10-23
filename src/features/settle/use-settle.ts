"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import {
	draftFromMinor,
	type MoneyInputResult,
} from "@retrospend/domain/parse";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useState } from "react";
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
 * amount starts empty; Everything sends no amount (the server pays exactly
 * everything, offsets included). Nothing here adds, converts or rounds.
 */
export function useSettle(
	person: PersonIdentityDTO | null,
	scope?: string | null,
) {
	const locale = useLocale();
	const [direction, setDirection] = useState<Direction | null>(null);
	const [currency, setCurrency] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [result, setResult] = useState<MoneyInputResult>(EMPTY);
	const [everything, setEverything] = useState(false);
	const [rateType, setRateType] = useState<string | null>(null);
	const [method, setMethod] = useState<string | null>(null);
	const [paidOn, setPaidOn] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [allowOverpay, setAllowOverpay] = useState(false);
	const [different, setDifferent] = useState(false);
	const [claim, setClaim] = useState<Claim | null>(null);
	const claimId = claim?.paymentId ?? null;

	const ref = useMemo(
		() =>
			person
				? { participantType: person.type, participantId: person.id }
				: null,
		[person],
	);
	const ctx = api.people.settleContext.useQuery(
		{
			person: ref ?? { participantType: "user", participantId: "-" },
			direction: direction ?? undefined,
			currency: currency ?? undefined,
			rateType,
			...(scope === undefined ? {} : { scope }),
		},
		{ enabled: ref !== null, placeholderData: keepPreviousData },
	);
	const c = ctx.data;
	const minor = result.ok ? result.minor : null;
	const hasAmount = everything || (minor !== null && minor > 0);

	const input: RecordInput | null = useMemo(() => {
		if (!ref || !c || !hasAmount) return null;
		return {
			person: ref,
			direction: c.direction,
			currency: c.currency,
			amount:
				everything || minor === null
					? null
					: fromMinor({ minor, currency: c.currency }),
			rateType,
			paymentMethod: method,
			paidOn: paidOn ?? c.today,
			note: note.trim() || null,
			...(scope === undefined ? {} : { applyTo: [{ scope }] }),
			allowOverpay,
			...(claimId && !different ? { matchClaimId: claimId } : {}),
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
		claimId,
		different,
	]);
	const settled = useSettled(input);
	const preview = api.settlement.paymentPreview.useQuery(
		settled as RecordInput,
		{
			enabled: settled !== null,
			placeholderData: keepPreviousData,
		},
	);
	const value = settled && preview.data ? preview.data.value : null;

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
			setResult(parsed);
			setEverything(false);
			reset();
		},
		/** Fills a server amount: Everything (sends no amount) or one currency part. */
		fill: (amount: { minor: number; currency: string }, all: boolean) => {
			setText(draftFromMinor(amount.minor, locale, amount.currency));
			setResult({ ok: true, minor: amount.minor, expression: false });
			setEverything(all);
			reset();
		},
		setDirection: (d: Direction) => {
			setDirection(d);
			setText("");
			setResult(EMPTY);
			setEverything(false);
			reset();
		},
		setCurrency: (code: string) => {
			setCurrency(code);
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
