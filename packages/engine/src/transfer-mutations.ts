/**
 * The transfer writes as device money mutations, for the preview runner and
 * the Undo sheet: each is the write function LocalDb runs (so a preview is the
 * write), with the figures it can change. The list is the server's
 * (transfers/create.mutation.ts TRANSFER_FIGURES) without the budget's four
 * and the envelope's: a move the device books never touches the budget (a
 * crossing one is the server's, transfer-kit.ts), so none of those can change.
 * src/server/services/__tests__/transfer-conformance.pg.test.ts holds the
 * list to the server's.
 */

import { deviceMutation } from "./preview";
import { createTransfer, TRANSFER_CREATE } from "./transfer-create-local";
import { deleteTransfer, TRANSFER_DELETE } from "./transfer-delete-local";

export const TRANSFER_FIGURES = [
	"netWorth",
	"accounts.balance",
	"notTracked",
	"netWorthChange.exchange",
	"spent",
] as const;

export const TRANSFER_CREATE_MUTATION = deviceMutation({
	id: TRANSFER_CREATE,
	touches: TRANSFER_FIGURES,
	write: createTransfer,
});

export const TRANSFER_DELETE_MUTATION = deviceMutation({
	id: TRANSFER_DELETE,
	touches: TRANSFER_FIGURES,
	write: deleteTransfer,
});
