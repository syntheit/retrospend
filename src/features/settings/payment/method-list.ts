import type {
	Method,
	Visibility,
} from "~/components/settings/payment-methods-card";

/** The list with item `index` moved by `delta` places; unchanged at the ends. */
export function moveMethod<T>(
	list: readonly T[],
	index: number,
	delta: -1 | 1,
): T[] {
	const to = index + delta;
	if (index < 0 || index >= list.length || to < 0 || to >= list.length)
		return [...list];
	const next = [...list];
	const [item] = next.splice(index, 1);
	next.splice(to, 0, item as T);
	return next;
}

/** The first method is the primary one (rank 1): Make primary moves it there. */
export function makePrimary<T>(list: readonly T[], index: number): T[] {
	if (index <= 0 || index >= list.length) return [...list];
	const next = [...list];
	const [item] = next.splice(index, 1);
	return [item as T, ...next];
}

export function withVisibility(
	list: readonly Method[],
	localId: string,
	visibility: Visibility,
): Method[] {
	return list.map((m) => (m.localId === localId ? { ...m, visibility } : m));
}

/**
 * paymentMethod.upsert replaces the whole list; rank follows the order.
 * Mirrors today's card (saveAll), so both pages write the same rows.
 */
export function toUpsertInput(list: readonly Method[]) {
	return list.map((m, i) => ({
		id: m.id,
		type: m.type,
		label: m.label || undefined,
		identifier: m.identifier || undefined,
		rank: i + 1,
		visibility: m.visibility,
		minAmount: m.minAmount ? Number.parseFloat(m.minAmount) : undefined,
		currency: m.currency || undefined,
		network: m.network || undefined,
	}));
}

/** Two lists are the same when order, ids and every field match. */
export function sameMethods(
	a: readonly Method[],
	b: readonly Method[],
): boolean {
	return JSON.stringify(toUpsertInput(a)) === JSON.stringify(toUpsertInput(b));
}
