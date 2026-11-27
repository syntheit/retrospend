/**
 * Vectors for transfer create and delete (see the files below for the rules
 * and the hand-derived values): what the device books, and what it leaves to
 * the server. The same steps run on the device (transfer-vectors.test.ts) and
 * on the server (src/server/services/__tests__/transfer-conformance.pg.test.ts).
 */
import type { TransferVector } from "./transfer-vector-types";
import { countedVectors } from "./transfer-vectors-counted";
import { gateVectors } from "./transfer-vectors-gates";
import { moneyVectors } from "./transfer-vectors-money";

export * from "./transfer-vector-types";
export { uuid } from "./transfer-vectors-kit";

export const transferVectors: TransferVector[] = [
	...moneyVectors,
	...countedVectors,
	...gateVectors,
];
