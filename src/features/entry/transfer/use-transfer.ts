"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { parseMoneyInput } from "@retrospend/domain/parse";
import { dayKey } from "@retrospend/domain/time-zone";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useState } from "react";
import { generateId } from "~/lib/id";
import { api } from "~/trpc/react";
import { type EntryCatalog, useSettled } from "../shared-ui";

type Amount = { text: string; minor: number | null };
const empty: Amount = { text: "", minor: null };

/**
 * Transfer and Exchange (MONEY-MOVES §2.3, §2.4): your own money between
 * two of your places. One currency: one amount. Two: both typed, and the
 * rate comes from them; an untyped side is booked at the reference rate.
 * The preview is transfer.create's dry run, so it lists every place that
 * moves and the exchange result against the reference.
 */
export function useTransfer(catalog: EntryCatalog, fromAccountId?: string) {
	const locale = useLocale();
	const places = catalog.places;
	const first = places.find((p) => p.id === fromAccountId) ?? places[0] ?? null;
	const [from, setFrom] = useState<string | null>(first?.id ?? null);
	const [to, setTo] = useState<string | null>(
		places.find((p) => p.id !== first?.id)?.id ?? null,
	);
	const [out, setOut] = useState<Amount>(empty);
	const [inn, setIn] = useState<Amount>(empty);
	const [fee, setFee] = useState<Amount>(empty);
	const [feeOpen, setFeeOpen] = useState(false);
	const [envelopeId, setEnvelopeId] = useState<string | null>(null);
	const [date, setDate] = useState(dayKey(new Date()));
	const [note, setNote] = useState("");
	// The sheet's own id: a second click cannot write a second move.
	const [id] = useState(generateId);
	const fromPlace = places.find((p) => p.id === from) ?? null;
	const toPlace = places.find((p) => p.id === to) ?? null;
	const fromCur = fromPlace?.currency ?? catalog.homeCurrency;
	const toCur = toPlace?.currency ?? catalog.homeCurrency;
	const exchange = fromCur !== toCur;
	const read = (text: string, currency: string): Amount => {
		const r = parseMoneyInput(text, locale, currency);
		return { text, minor: r.ok ? r.minor : null };
	};
	const errors = {
		same: !!from && from === to,
		amount: !out.minor,
		both: exchange && !inn.minor,
	};
	const valid = !errors.same && !errors.amount && !(exchange && !inn.minor);
	const input = valid
		? {
				fromAccountId: from,
				toAccountId: to,
				fromCurrency: fromCur,
				toCurrency: toCur,
				fromAmount: fromMinor({ minor: out.minor ?? 0, currency: fromCur }),
				...(exchange && inn.minor
					? { toAmount: fromMinor({ minor: inn.minor, currency: toCur }) }
					: {}),
				date,
				...(note.trim() ? { note: note.trim() } : {}),
				...(fee.minor
					? {
							fee: {
								amount: fromMinor({ minor: fee.minor, currency: fromCur }),
								accountId: from,
							},
						}
					: {}),
				...(envelopeId ? { envelopeId } : {}),
			}
		: null;
	const settled = useSettled(input, 350);
	const preview = api.entry.transfer.preview.useQuery(settled ?? EMPTY, {
		enabled: !!settled,
		placeholderData: keepPreviousData,
		retry: false,
	});
	const save = api.entry.transfer.save.useMutation();
	const undo = api.wealth.transfers.delete.save.useMutation();
	return {
		from,
		to,
		fromPlace,
		toPlace,
		fromCur,
		toCur,
		exchange,
		out,
		inn,
		fee,
		feeOpen,
		envelopeId,
		date,
		note,
		setFrom: (id: string | null) => {
			setFrom(id);
			setOut(empty);
			setIn(empty);
			setEnvelopeId(null);
		},
		setTo: (id: string | null) => {
			setTo(id);
			setIn(empty);
			setEnvelopeId(null);
		},
		setOut: (text: string) => setOut(read(text, fromCur)),
		setIn: (text: string) => setIn(read(text, toCur)),
		setFee: (text: string) => setFee(read(text, fromCur)),
		openFee: () => setFeeOpen(true),
		setEnvelopeId,
		setDate,
		setNote,
		errors,
		valid,
		preview: valid ? (preview.data ?? null) : null,
		previewLoading: preview.isFetching,
		previewError: preview.error?.message ?? null,
		save: () =>
			input
				? save.mutateAsync({ ...input, id })
				: Promise.reject(new Error("Nothing to save")),
		undo: (transferId: string) => undo.mutateAsync({ transferId }),
		busy: save.isPending,
	};
}

const EMPTY = { fromAccountId: null, toAccountId: null, fromAmount: "1" };
