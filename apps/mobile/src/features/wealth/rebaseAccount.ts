import type { RetrospendClient } from "@retrospend/api-client";
import type { AccountOp } from "@retrospend/engine/device";
import type { DeviceWrites } from "@/data/device-engine";
import { newClientId } from "@/data/ids";
import type { Outbox, OutboxEntry } from "@/data/outbox";
import type { PreviewDto } from "@/features/entry/preview";
import { deviceOf, exclusive } from "@/features/entry/queue";

// Try again on a parked account write that met another device's change
// (account_changed). A balance update, a close, a reopen and a rate type
// switch each state one thing, so the same statement is saved again over the
// account as the last pull left it: a new write under new keys, checked
// against the pulled version and stored balance, and previewed before it is
// sent. A whole-account edit is not re-based (which fields the person
// changed is unknown, and saving it again would put the old ones back).

type Restated = Exclude<AccountOp, { kind: "accountCreate" | "accountUpdate" }>;

export interface AccountRebasePlan {
	op: Restated;
	/** The pulled version the new write is checked against. */
	version: number;
	/** What the new entry sends: the statement and the stored balance it saw. */
	payload: Record<string, unknown>;
}

const text = (v: unknown) => (typeof v === "string" ? v : undefined);

/** The op the entry states over the pulled account, with fresh row ids; null when it is not a statement to save again. */
function restatedOp(entry: OutboxEntry, closed: boolean): Restated | null {
	const p = (entry.payload ?? {}) as Record<string, unknown>;
	const id = entry.targetId;
	switch (entry.kind) {
		case "balance": {
			const balance = text(p.balance);
			if (balance === undefined) return null;
			return {
				kind: "accountBalance",
				body: {
					id,
					balance,
					...(p.rateType !== undefined
						? { rateType: p.rateType as string | null }
						: {}),
					...(p.exchangeRate !== undefined
						? { exchangeRate: p.exchangeRate as string | null }
						: {}),
					legId: newClientId(),
					rateTypeId: newClientId(),
				},
			};
		}
		// Already in the state it asked for: nothing left to do.
		case "close":
			return closed ? null : { kind: "accountClose", body: { id } };
		case "reopen":
			return closed ? { kind: "accountReopen", body: { id } } : null;
		case "rateType":
			return {
				kind: "accountRateType",
				body: {
					id,
					rateType: (p.rateType as string | null | undefined) ?? null,
					...(p.from !== undefined ? { from: p.from as string | null } : {}),
					rateTypeId: newClientId(),
				},
			};
		default:
			return null;
	}
}

/** What Try again would save, or null when it cannot be read: not a parked account statement, or the account is not in the pulled store. */
export async function planAccountRebase(input: {
	outbox: Outbox;
	writes: DeviceWrites;
	clientId: string;
}): Promise<AccountRebasePlan | null> {
	const entry = (await input.outbox.all()).find(
		(e) => e.clientId === input.clientId,
	);
	if (entry?.state !== "conflict" || entry.entity !== "accounts") return null;
	const seen = await input.writes.storedAccount(entry.targetId);
	if (!seen) return null;
	const op = restatedOp(entry, seen.closed);
	if (!op) return null;
	return {
		op,
		version: seen.version,
		payload: {
			...op.body,
			...(op.kind === "accountBalance"
				? { expectedBalance: seen.balance }
				: {}),
		},
	};
}

/** The server's dry run of the re-based write, against the pulled version and balance. */
export function previewAccountRebase(
	api: RetrospendClient,
	plan: AccountRebasePlan,
	options: { signal: AbortSignal },
): Promise<PreviewDto> {
	const expectedVersion = plan.version;
	const { op } = plan;
	switch (op.kind) {
		case "accountBalance":
			return api.accounts.previewUpdateBalance(
				{
					...op.body,
					expectedVersion,
					expectedBalance: plan.payload.expectedBalance as string,
				},
				options,
			) as Promise<PreviewDto>;
		case "accountClose":
			return api.accounts.previewClose(
				{ id: op.body.id, expectedVersion },
				options,
			) as Promise<PreviewDto>;
		case "accountReopen":
			return api.accounts.previewReopen(
				{ id: op.body.id, expectedVersion },
				options,
			) as Promise<PreviewDto>;
		case "accountRateType":
			return api.accounts.previewSetRateType(
				{ ...op.body, expectedVersion },
				options,
			) as Promise<PreviewDto>;
	}
}

/**
 * Swaps the parked entry for the re-based one: a fresh `clientId`, the same
 * account, the pulled version as its base, and the device's booking of it.
 * Returns the new client id, or null when the entry is not parked any more.
 */
export function commitAccountRebase(input: {
	outbox: Outbox;
	writes: DeviceWrites;
	clientId: string;
	plan: AccountRebasePlan;
}): Promise<string | null> {
	const { outbox, writes, clientId, plan } = input;
	return exclusive(outbox, async () => {
		const old = (await outbox.all()).find((e) => e.clientId === clientId);
		if (old?.state !== "conflict") return null;
		const next = newClientId();
		const booked = await writes.book(plan.op);
		// The account's name stays on the row Sync issues shows.
		const title = (old.payload as { title?: unknown } | null)?.title;
		await outbox.replace(clientId, {
			clientId: next,
			entity: old.entity,
			kind: old.kind,
			targetId: old.targetId,
			baseVersion: String(plan.version),
			payload:
				typeof title === "string" ? { ...plan.payload, title } : plan.payload,
			...(booked ? { device: deviceOf(booked) } : {}),
		});
		await writes.refresh().catch(() => undefined);
		return next;
	});
}

/**
 * What Try again offers for a parked account statement: the server's dry run
 * of the re-based write, and the save that swaps the entry and sends it
 * (`done` flushes and says whether the server took it). Null when it cannot
 * be previewed: nothing is sent unseen.
 */
export async function accountOffer(input: {
	outbox: Outbox;
	api: RetrospendClient;
	writes: DeviceWrites;
	clientId: string;
	kind:
		| "close"
		| "reopen"
		| "balance"
		| "rateType"
		| "update"
		| "delete"
		| "confirm"
		| "skip";
	options: { signal: AbortSignal };
	done: (next: string) => Promise<boolean>;
}) {
	const { outbox, api, writes, clientId, options } = input;
	const plan = await planAccountRebase({ outbox, writes, clientId });
	if (!plan) return null;
	const diff = await previewAccountRebase(api, plan, options);
	return {
		kind: input.kind,
		diff,
		save: async () => {
			const next = await commitAccountRebase({
				outbox,
				writes,
				clientId,
				plan,
			});
			return next ? input.done(next) : false;
		},
	};
}
