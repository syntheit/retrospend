/**
 * The guest sessions of one address (E2EE D11 Revision 3, PR 4): the one
 * place that finds them for a migration or a deletion, so the rule is written
 * once. The lookup is `contactLookup`'s: the hash once the epoch is set,
 * otherwise a case-insensitive match on the plaintext address (escaped, so it
 * is equality and not a pattern). The plaintext path may still return a
 * superset (Postgres folds non-ASCII case by its own locale), so the stored
 * address is compared again in JS with `matchesContact`.
 */
import type { PrismaClient } from "~prisma";
import {
	contactLookup,
	contactLookupIfKeyed,
	matchesContact,
} from "./keys/contact-hash";

export async function findGuestSessionsByEmail(
	db: PrismaClient,
	email: string,
	// A cleanup that a lost instance key must not block: no match, not a failure.
	options: { skipIfKeyLost?: boolean } = {},
): Promise<{ id: string; projectId: string }[]> {
	const lookup = options.skipIfKeyLost
		? await contactLookupIfKeyed("guest_session", email)
		: await contactLookup("guest_session", email);
	if (!lookup) return [];
	const found = await db.guestSession.findMany({
		where: lookup,
		// The hash path matched exactly and its address is sealed: not read.
		select: { id: true, projectId: true, email: !("emailHash" in lookup) },
	});
	return found
		.filter((s) => matchesContact(lookup, email, s.email))
		.map(({ id, projectId }) => ({ id, projectId }));
}
