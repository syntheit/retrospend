"use client";

import { useState } from "react";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { useMoneyWrite } from "./use-money-write";
import { newId } from "./use-write";

export type TransferInput = Omit<
	RouterInputs["entry"]["transfer"]["preview"],
	"id"
>;
export type TransferSaved = RouterOutputs["entry"]["transfer"]["save"];

/**
 * A money move across the budget line (Move to Wealth, Move from Wealth):
 * the Transfer sheet's own procedures (`entry.transfer`), so the server's dry
 * run is the same write Save makes, with the budget side (an envelope, or
 * Not planned yet) named by the input. Undo deletes the transfer, which takes
 * its legs and its budget side with it.
 */
export function useTransferWrite(o: {
	input: TransferInput | null;
	toast: (saved: TransferSaved) => string;
}) {
	const utils = api.useUtils();
	const save = api.entry.transfer.save.useMutation();
	const remove = api.wealth.transfers.delete.save.useMutation();
	const [id] = useState(newId);
	return useMoneyWrite({
		input: o.input,
		preview: (i) => utils.entry.transfer.preview.fetch(i, { staleTime: 0 }),
		commit: (i) => save.mutateAsync({ ...i, id }),
		toast: o.toast,
		undo: (r) => () => remove.mutateAsync({ transferId: r.value.transferId }),
	});
}
