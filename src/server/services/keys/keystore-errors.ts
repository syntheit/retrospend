/**
 * The keystore SQLSTATE mapping both key services share (data-key.service.ts,
 * instance-key.service.ts). Each service passes a factory that builds its own
 * typed error from the kind.
 */
import { Prisma } from "~prisma";

export type KeystoreFailure =
	/** 42P01 (no table), 3F000 (no schema) or 42883 (no function). */
	| "missing"
	/** 28000: the functions refused the caller (no actor, or one the database does not know). */
	| "refused"
	/** 42501: a missing grant, which a restore leaves behind because dumps carry no privileges. */
	| "grants"
	/** KS001: the mint function refusing to replace a key that was lost. */
	| "lost";

/** The Postgres error code of a failed raw query, as Prisma reports it. */
export function pgCode(error: unknown): string | undefined {
	if (!(error instanceof Prisma.PrismaClientKnownRequestError))
		return undefined;
	const meta = error.meta as
		| { driverAdapterError?: { cause?: { originalCode?: string } } }
		| undefined;
	return meta?.driverAdapterError?.cause?.originalCode;
}

/** The failure kind a SQLSTATE stands for, undefined for any other error. */
export function keystoreFailure(error: unknown): KeystoreFailure | undefined {
	const code = pgCode(error);
	if (code === "42P01" || code === "3F000" || code === "42883") return "missing";
	if (code === "28000") return "refused";
	if (code === "42501") return "grants";
	if (code === "KS001") return "lost";
	return undefined;
}

/**
 * Runs one keystore query and turns the failures a caller can act on into the
 * service's stable error; anything else passes through unchanged.
 */
export async function mapKeystoreErrors<T>(
	query: () => Promise<T>,
	makeError: (failure: KeystoreFailure) => Error,
): Promise<T> {
	try {
		return await query();
	} catch (error) {
		const failure = keystoreFailure(error);
		if (failure) throw makeError(failure);
		throw error;
	}
}
