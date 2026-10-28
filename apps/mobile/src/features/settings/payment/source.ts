import type { RetrospendClient } from "@retrospend/api-client";
import type { CacheKey } from "@/features/read/loadCached";

type Client = RetrospendClient["payment-methods"];

export type PaymentMethod = Awaited<
	ReturnType<Client["list"]>
>["items"][number];
export type Visibility = PaymentMethod["visibility"];
export type MethodInput = Parameters<Client["replace"]>[0]["methods"][number];

export const PAYMENT_CACHE: CacheKey = { name: "settings.payment", schema: 1 };

export function fetchPaymentMethods(api: RetrospendClient) {
	return async (): Promise<PaymentMethod[]> =>
		(await api["payment-methods"].list()).items;
}

/** A saved method as the replace route wants it back (the id keeps it the same row). */
export function inputOf(method: PaymentMethod): MethodInput {
	return {
		id: method.id,
		type: method.type,
		label: method.label,
		identifier: method.identifier,
		visibility: method.visibility,
		minAmount: method.minAmount,
		currency: method.currency,
		network: method.network,
	};
}

export interface MethodEdit {
	label: string;
	identifier: string;
	visibility: Visibility;
}

/** The whole list with one method edited. */
export function withEdit(
	methods: readonly PaymentMethod[],
	id: string,
	edit: MethodEdit,
): MethodInput[] {
	return methods.map((m) =>
		m.id === id
			? {
					...inputOf(m),
					label: edit.label.trim() === "" ? null : edit.label.trim(),
					identifier:
						edit.identifier.trim() === "" ? null : edit.identifier.trim(),
					visibility: edit.visibility,
				}
			: inputOf(m),
	);
}

/** The whole list without one method. */
export function without(
	methods: readonly PaymentMethod[],
	id: string,
): MethodInput[] {
	return methods.filter((m) => m.id !== id).map(inputOf);
}

/** The whole list with one method first: the one you prefer. */
export function preferred(
	methods: readonly PaymentMethod[],
	id: string,
): MethodInput[] {
	const first = methods.find((m) => m.id === id);
	if (!first) return methods.map(inputOf);
	return [first, ...methods.filter((m) => m.id !== id)].map(inputOf);
}
