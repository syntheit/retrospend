import type { Money } from "@retrospend/domain/money-minor";
import Storage from "expo-sqlite/kv-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import type { PersonRef, SettleContext } from "@/features/people/source";
import {
	type AmountChoice,
	allocationDetail,
	answerFor,
	type Direction,
	everythingConverts,
	isOverpay,
	type PaymentPreview,
	recordInput,
	startMethod,
} from "./plan";

const LAST_METHOD = "ui.settle.method";

/** How the last payment was made; a convenience, so a failed read is none. */
function readLastMethod(): string | null {
	try {
		return Storage.getItemSync(LAST_METHOD);
	} catch {
		return null;
	}
}

function writeLastMethod(method: string | null): void {
	if (!method) return;
	try {
		Storage.setItemSync(LAST_METHOD, method);
	} catch {
		// Remembering is a convenience; the payment is recorded either way.
	}
}

export interface Recorded {
	/** PROPOSED waits for the other person to confirm. */
	status: "PROPOSED" | "FINALIZED";
	undoToken: string;
}

export type SettleStatus = "loading" | "ready" | "loadError";

/** More than everything owed: by how much, and what the exact payment is. */
export interface Overpaid {
	over: Money | null;
	exact: Money | null;
}

/** A method the person and the other side both have. */
export interface SharedMethod {
	type: string;
	label: string | null;
}

/**
 * The Settle up flow's state: what is owed (GET /people/{type}/{id}/settle),
 * the preview of the exact write (POST /payments/preview), and the record
 * (POST /payments) keyed by one id per distinct body, so a retry after a
 * dropped connection replays instead of paying twice and a changed body is
 * a different payment. The rate type, the method and the day travel in the
 * same body, so the preview shows what they change before Record.
 */
export function useSettle(person: PersonRef, active: boolean) {
	const { api } = useSession();
	const [context, setContext] = useState<SettleContext | null>(null);
	const [status, setStatus] = useState<SettleStatus>("loading");
	const [direction, setDirection] = useState<Direction | null>(null);
	const [choice, setChoice] = useState<AmountChoice>({ kind: "everything" });
	const [rateType, setRateType] = useState<string | null>(null);
	const [method, setMethodState] = useState<string | null>(null);
	// Until the person picks a method, the start one (the last used, or the
	// first you share with them) is what the payment carries.
	const methodTouched = useRef(false);
	const setMethod = useCallback((next: string | null) => {
		methodTouched.current = true;
		setMethodState(next);
	}, []);
	// What one unit of a debt currency is worth at each rate type, so the
	// chips can show the rate they would use; the server prices each type.
	const [typeRates, setTypeRates] = useState<Record<string, Money>>({});
	const [paidOn, setPaidOn] = useState<string | null>(null);
	// A new rate type moves Everything and the parts: until the server's
	// figures are in again, nothing is previewed or recorded.
	const [repricing, setRepricing] = useState(false);
	const [shared, setShared] = useState<SharedMethod[]>([]);
	// The dry run, kept with the request it answered: a preview that is not of
	// the request on screen is never shown and never recorded.
	const [settled, setSettled] = useState<{
		key: string;
		preview: PaymentPreview | null;
		failed: "error" | "overpay" | null;
		overpaid: Overpaid | null;
	} | null>(null);
	const [recording, setRecording] = useState(false);
	const [recordFailed, setRecordFailed] = useState<"error" | "overpay" | null>(
		null,
	);
	// One id (also the idempotency key) per distinct request: a retry of the
	// same body replays, a changed body is a different payment.
	const write = useRef({ body: "", id: newClientId() });

	const read = useCallback(
		async (next: Direction | undefined, rate: string | null) => {
			if (!api) return;
			setStatus("loading");
			setSettled(null);
			try {
				const ctx = await api.people.settle({
					type: person.type,
					id: person.id,
					direction: next,
					rateType: rate ?? undefined,
				});
				setContext(ctx);
				setDirection(ctx.direction);
				setChoice({ kind: "everything" });
				setStatus("ready");
			} catch {
				setStatus("loadError");
			}
		},
		[api, person.type, person.id],
	);

	// Each opening starts from what the server suggests, with a fresh write id.
	useEffect(() => {
		if (!active) return;
		write.current = { body: "", id: newClientId() };
		setRecordFailed(null);
		setRateType(null);
		methodTouched.current = false;
		setMethodState(null);
		setPaidOn(null);
		setTypeRates({});
		read(undefined, null);
	}, [active, read]);

	// The methods you both have, offered when you pay a person on Retrospend.
	useEffect(() => {
		if (!api || !active || person.type !== "user" || direction !== "outgoing") {
			setShared([]);
			return;
		}
		let cancelled = false;
		api["payment-methods"]
			.match({ type: person.type, id: person.id })
			.then((result) => {
				if (!cancelled)
					setShared(
						result.compatible.map((m) => ({ type: m.type, label: m.label })),
					);
			})
			.catch(() => !cancelled && setShared([]));
		return () => {
			cancelled = true;
		};
	}, [api, active, person.type, person.id, direction]);

	// A new opening, or another set of shared methods, preselects the method.
	useEffect(() => {
		if (!active || methodTouched.current) return;
		setMethodState(startMethod(readLastMethod(), shared));
	}, [active, shared]);

	// The rate each type would use, when a debt turns into the payment
	// currency and there is a choice of types: one read per type.
	const typesKey =
		context && direction && everythingConverts(context, direction)
			? context.rateTypes.join(",")
			: "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: `typesKey` stands for the types, `direction` for the way they price
	useEffect(() => {
		const types = typesKey.split(",").filter(Boolean);
		if (!api || !active || !direction || types.length < 2) return;
		let cancelled = false;
		for (const type of types) {
			api.people
				.settle({ type: person.type, id: person.id, direction, rateType: type })
				.then((ctx) => {
					const rate = ctx.rates.find((r) => r.rate !== null)?.rate;
					if (!cancelled && rate)
						setTypeRates((was) => ({ ...was, [type]: rate.value }));
				})
				.catch(() => {});
		}
		return () => {
			cancelled = true;
		};
	}, [api, active, typesKey, direction, person.type, person.id]);

	const draft =
		context && direction && !repricing
			? recordInput(person, context, direction, choice, "", {
					rateType,
					paymentMethod: method,
					paidOn,
				})
			: null;
	const inputKey = draft ? JSON.stringify({ ...draft, id: undefined }) : null;
	if (inputKey !== null && write.current.body !== inputKey) {
		write.current = { body: inputKey, id: newClientId() };
	}
	const input = draft ? { ...draft, id: write.current.id } : null;

	// The preview is a dry run of this very input; it follows every change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `inputKey` stands for `input`
	useEffect(() => {
		if (!api || !input || inputKey === null || status !== "ready") return;
		let cancelled = false;
		api.payments
			.previewRecord(input)
			.then((result) => {
				if (!cancelled)
					setSettled({
						key: inputKey,
						preview: result,
						failed: null,
						overpaid: null,
					});
			})
			.catch(async (error) => {
				if (isOverpay(error)) {
					// The server refuses the extra; asking again with it allowed
					// is the only way to read by how much, and what is exact.
					const probe = await api.payments
						.previewRecord({ ...input, allowOverpay: true })
						.then(allocationDetail)
						.catch(() => null);
					if (!cancelled)
						setSettled({
							key: inputKey,
							preview: null,
							failed: "overpay",
							overpaid: {
								over: probe?.overpay ?? null,
								exact: probe?.full ?? null,
							},
						});
					return;
				}
				if (!cancelled)
					setSettled({
						key: inputKey,
						preview: null,
						failed: "error",
						overpaid: null,
					});
			});
		return () => {
			cancelled = true;
		};
	}, [api, inputKey, status]);

	const current = answerFor(settled, inputKey);
	const preview = current?.preview ?? null;

	const changeDirection = useCallback(
		(next: Direction) => {
			if (next !== direction) read(next, rateType);
		},
		[direction, rateType, read],
	);

	const changeRate = useCallback(
		async (type: string) => {
			if (!api || !direction || type === rateType) return;
			setRateType(type);
			setRepricing(true);
			try {
				const ctx = await api.people.settle({
					type: person.type,
					id: person.id,
					direction,
					rateType: type,
				});
				setContext(ctx);
			} catch {
				setStatus("loadError");
			} finally {
				setRepricing(false);
			}
		},
		[api, direction, person.type, person.id, rateType],
	);

	const record = useCallback(async (): Promise<Recorded | null> => {
		// Only the request the person was shown is recorded.
		if (!api || !input || !preview) return null;
		setRecording(true);
		setRecordFailed(null);
		try {
			const result = await api.payments.record(input, {
				context: { idempotencyKey: input.id },
			});
			writeLastMethod(input.paymentMethod ?? null);
			return { status: result.status, undoToken: result.undo };
		} catch (error) {
			setRecordFailed(isOverpay(error) ? "overpay" : "error");
			return null;
		} finally {
			setRecording(false);
		}
	}, [api, input, preview]);

	const undo = useCallback(
		async (token: string): Promise<boolean> => {
			if (!api) return false;
			try {
				await api.payments.undo(
					{ token },
					{ context: { idempotencyKey: newClientId() } },
				);
				return true;
			} catch {
				return false;
			}
		},
		[api],
	);

	return {
		context,
		status,
		direction,
		choice,
		setChoice,
		changeDirection,
		rateType,
		repricing,
		changeRate,
		method,
		setMethod,
		typeRates,
		paidOn,
		setPaidOn,
		shared,
		preview,
		previewFailed: current?.failed === "error",
		/** The amount is more than everything owed (the server's `overpay`). */
		overpaid: current?.failed === "overpay" || recordFailed === "overpay",
		/** By how much, and the exact payment, when the dry run said. */
		overpaidBy: current?.overpaid ?? null,
		recording,
		recordFailed: recordFailed === "error",
		record,
		undo,
		retryLoad: () => read(direction ?? undefined, rateType),
	};
}
