export type Visibility = "PUBLIC" | "FRIENDS_ONLY" | "PAYMENT_ONLY";

export interface Method {
	id?: string;
	localId: string;
	type: string;
	label: string;
	identifier: string;
	visibility: Visibility;
	minAmount: string;
	currency: string;
	network: string;
}

let localIdCounter = 0;

/** A key for a method that is not saved yet. */
export function newLocalId() {
	return `local_${++localIdCounter}`;
}
