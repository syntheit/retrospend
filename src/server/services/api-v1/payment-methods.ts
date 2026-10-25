import type {
	paymentMethodInputSchema,
	personParamsSchema,
} from "@retrospend/api-contract";
import type * as z from "zod";
import type { LedgerCaller } from "./money-op";
import { exactAmount } from "./amounts";
import { trpcPaymentMethod } from "./trpc-bridge";

/**
 * v1 adapters for /payment-methods. The list, the replace and the match
 * (with its visibility rule) are the paymentMethod procedures, run in-process.
 */

type MethodInput = z.infer<typeof paymentMethodInputSchema>;
type PersonParams = z.infer<typeof personParamsSchema>;

type Row = {
	id: string;
	type: string;
	label: string | null;
	identifier: string | null;
	rank: number;
	visibility: "PUBLIC" | "FRIENDS_ONLY" | "PAYMENT_ONLY";
	minAmount: { toString(): string } | null;
	currency: string | null;
	network: string | null;
	updatedAt: Date;
};

const shared = (m: Row) => ({
	type: m.type,
	label: m.label,
	identifier: m.identifier,
	rank: m.rank,
	visibility: m.visibility,
	minAmount: m.minAmount?.toString() ?? null,
	currency: m.currency,
	network: m.network,
});

const methodOf = (m: Row) => ({
	id: m.id,
	...shared(m),
	updatedAt: m.updatedAt.toISOString(),
});

export async function listPaymentMethods(caller: LedgerCaller) {
	const rows = await (await trpcPaymentMethod(caller)).list();
	return { items: rows.map(methodOf) };
}

const wireOf = (m: MethodInput, index: number) => ({
	id: m.id,
	type: m.type,
	label: m.label ?? undefined,
	identifier: m.identifier ?? undefined,
	rank: index + 1,
	visibility: m.visibility,
	minAmount: m.minAmount
		? exactAmount(m.minAmount, m.currency ?? "USD", "minAmount")
		: undefined,
	currency: m.currency ?? undefined,
	network: m.network ?? undefined,
});

export async function replacePaymentMethods(
	caller: LedgerCaller,
	methods: MethodInput[],
) {
	await (await trpcPaymentMethod(caller)).upsert({
		methods: methods.map(wireOf),
	});
	return listPaymentMethods(caller);
}

export async function matchPaymentMethods(
	caller: LedgerCaller,
	person: PersonParams,
) {
	const found = await (await trpcPaymentMethod(caller)).match({
		participantType: person.type,
		participantId: person.id,
	});
	return {
		compatible: found.compatible,
		yourMethods: found.yourMethods.map(methodOf),
		theirMethods: found.theirMethods.map(shared),
	};
}
