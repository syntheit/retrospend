import { createTransfer, type TransferBody } from "../transfer-create-local";
import { deleteTransfer } from "../transfer-delete-local";
import {
	TRANSFER_CREATE_MUTATION,
	TRANSFER_DELETE_MUTATION,
} from "../transfer-mutations";

// A person's transfer create or delete, as the device books it: the engine's
// transfer mutations over the same fields the v1 bodies take, so the device's
// rows and the server's meet by the body's client-made ids. As with account
// writes the booking checks no version (a transfer has none): the server
// decides at send, and a view that has moved on only makes this a refusal. A
// move the device cannot see whole (the budget, a missing row) refuses with a
// TransferOnlineError and is sent straight to the server (transfer-kit.ts).
//
// The transfer's rows go in `wealth` (the same family as the account writes,
// until the outbox and the compare know them); its fee is an expense like any
// other and goes in `changes`, where the overlay and the compare already read
// expenses.

export type { TransferBody as TransferCreateBody };

export interface TransferDeleteBody {
	id: string;
}

export type TransferOp =
	| { kind: "transferCreate"; body: TransferBody }
	| { kind: "transferDelete"; body: TransferDeleteBody };

export const isTransferOp = (op: { kind: string }): op is TransferOp =>
	op.kind.startsWith("transfer");

/** The mutation of a transfer write, the figures it moves, and its write over `now`. */
export function transferPlanOf(
	op: TransferOp,
	now: Date,
	budgetPulled: boolean,
) {
	return op.kind === "transferCreate"
		? {
				id: TRANSFER_CREATE_MUTATION.id,
				touches: TRANSFER_CREATE_MUTATION.touches,
				write: createTransfer({ ...op.body, now, budgetPulled }),
			}
		: {
				id: TRANSFER_DELETE_MUTATION.id,
				touches: TRANSFER_DELETE_MUTATION.touches,
				write: deleteTransfer({ ...op.body, budgetPulled }),
			};
}
