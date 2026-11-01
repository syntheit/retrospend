import { fromMinor, money } from "@retrospend/domain/money-minor";
import { amountMinor, type PendingWrite } from "./draftAmount";
import type { EntryPlace } from "./types";

// The transfer composer's state and the write it becomes.

export interface TransferDraft {
	/** The new transfer's id, made once per composer. */
	id: string;
	fromId: string | null;
	toId: string | null;
	/** What leaves the first account, in its currency. */
	amountText: string;
	/** Exchange only: what arrived. Empty: the server books the reference rate. */
	receivedText: string;
	note: string;
	date: string;
	/** A bank fee in the sending account's currency; empty is none. */
	feeText: string;
}

export function newTransferDraft(input: {
	id: string;
	date: string;
	currency: string;
	places: EntryPlace[];
}): TransferDraft {
	// From: an account in the currency you usually spend in; To: another one.
	const from =
		input.places.find((p) => p.currency === input.currency) ?? input.places[0];
	const to = input.places.find((p) => p.id !== from?.id);
	return {
		id: input.id,
		fromId: from?.id ?? null,
		toId: to?.id ?? null,
		amountText: "",
		receivedText: "",
		note: "",
		date: input.date,
		feeText: "",
	};
}

export type TransferErrors = Partial<
	Record<"amount" | "same" | "places" | "received" | "fee", true>
>;

/** The place a transfer leaves from, with its currency (the amount's). */
export function transferCurrencies(
	d: TransferDraft,
	places: EntryPlace[],
): { from: string | null; to: string | null } {
	return {
		from: places.find((p) => p.id === d.fromId)?.currency ?? null,
		to: places.find((p) => p.id === d.toId)?.currency ?? null,
	};
}

export function transferErrors(
	d: TransferDraft,
	input: { locale: string; places: EntryPlace[] },
): TransferErrors {
	const errors: TransferErrors = {};
	const { from } = transferCurrencies(d, input.places);
	if (!d.fromId || !d.toId) errors.places = true;
	else if (d.fromId === d.toId) errors.same = true;
	if (!from || !amountMinor(d.amountText, input.locale, from)) {
		errors.amount = true;
	}
	// What arrived is optional, but text that is not an amount is not "empty".
	const { to } = transferCurrencies(d, input.places);
	if (
		from &&
		to &&
		from !== to &&
		d.receivedText.trim() !== "" &&
		!amountMinor(d.receivedText, input.locale, to)
	) {
		errors.received = true;
	}
	if (
		from &&
		d.feeText.trim() !== "" &&
		!amountMinor(d.feeText, input.locale, from)
	) {
		errors.fee = true;
	}
	return errors;
}

/**
 * Move money between two of your accounts. Two currencies make it an
 * exchange: what arrived is optional, and the server books the reference
 * rate for a side left empty.
 */
export function buildTransferWrite(
	d: TransferDraft,
	input: { locale: string; places: EntryPlace[] },
): PendingWrite | null {
	if (Object.keys(transferErrors(d, input)).length > 0) return null;
	const { from, to } = transferCurrencies(d, input.places);
	if (!from || !to) return null;
	const out = amountMinor(d.amountText, input.locale, from);
	if (!out) return null;
	const received =
		from === to ? null : amountMinor(d.receivedText, input.locale, to);
	const note = d.note.trim();
	const fee = amountMinor(d.feeText, input.locale, from);
	const fromName = input.places.find((p) => p.id === d.fromId)?.name ?? "";
	const toName = input.places.find((p) => p.id === d.toId)?.name ?? "";
	return {
		entity: "transfers",
		label: `${fromName} > ${toName}`,
		body: {
			id: d.id,
			fromAccountId: d.fromId,
			toAccountId: d.toId,
			fromCurrency: from,
			toCurrency: to,
			fromAmount: fromMinor(money(out, from)),
			...(received ? { toAmount: fromMinor(money(received, to)) } : {}),
			date: d.date,
			...(note ? { note } : {}),
			...(fee
				? {
						fee: {
							amount: fromMinor(money(fee, from)),
							accountId: d.fromId,
						},
					}
				: {}),
		},
	};
}
