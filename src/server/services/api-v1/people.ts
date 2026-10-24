import type { CursorQuery, renamePersonSchema } from "@retrospend/api-contract";
import { OUTSIDE_PROJECTS } from "@retrospend/api-contract";
import * as z from "zod";
import { personPage } from "~/server/services/people/detail";
import { ledgerRows } from "~/server/services/people/ledger-rows";
import { peopleOverview } from "~/server/services/people/overview";
import {
	settleContext,
	type settleContextSchema,
} from "~/server/services/people/settle-context";
import {
	addShadow,
	mintClaimLink,
	renameShadow,
} from "~/server/services/shadow-profile.service";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import { PeopleService } from "~/server/services/shared-expenses/people.service";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Caller } from "./caller";
import { decodeCursor, encodeCursor } from "./cursor";
import { thaw } from "./thaw";

/**
 * v1 adapters for /people. The reads are the web's People and Person page
 * reads, so the two transports agree. Adding, renaming and the claim link
 * are shadow-profile.service.ts, which the tRPC routers call too.
 */

type LedgerCaller = Caller & { timeZone: string };
type PersonRef = { type: ParticipantRef["participantType"]; id: string };

const refOf = (p: PersonRef): ParticipantRef => ({
	participantType: p.type,
	participantId: p.id,
});

const meOf = (caller: Caller): ParticipantRef => ({
	participantType: "user",
	participantId: caller.principal.userId,
});

export const listPeople = async (caller: Caller) =>
	thaw(await peopleOverview(caller.db, caller.principal.userId));

export const readPerson = async (caller: Caller, person: PersonRef) =>
	thaw(await personPage(caller.db, caller.principal.userId, refOf(person)));

const ledgerCursor = z.object({ before: z.string().min(1).max(128) });

/**
 * One page of the shared expenses with a person. The cursor is the web's own
 * (the date of the last row), wrapped so clients treat it as opaque.
 */
export async function listPersonLedger(
	caller: Caller,
	person: PersonRef,
	q: CursorQuery & { projectId?: string },
) {
	const me = meOf(caller);
	const ref = refOf(person);
	const after = decodeCursor(q.cursor, ledgerCursor);
	const page = await new PeopleService(caller.db, me).getPersonDetailCursor(
		ref,
		{ limit: q.limit, cursor: after?.before, projectId: q.projectId },
	);
	const { aliasesByKey } = await resolveClaimAliases(caller.db, [me, ref]);
	const keys = (r: ParticipantRef) =>
		(aliasesByKey.get(`${r.participantType}:${r.participantId}`) ?? [r]).map(
			(a) => `${a.participantType}:${a.participantId}`,
		);
	const items = await ledgerRows(caller.db, page.transactions, {
		mine: new Set(keys(me)),
		theirs: new Set(keys(ref)),
	});
	return {
		items: thaw(items),
		nextCursor: page.nextCursor
			? encodeCursor({ before: page.nextCursor })
			: null,
	};
}

export async function readSettleContext(
	caller: LedgerCaller,
	person: PersonRef,
	q: {
		direction?: "outgoing" | "incoming";
		currency?: string;
		rateType?: string;
		scope?: string;
	},
) {
	const input: z.infer<typeof settleContextSchema> = {
		person: { participantType: person.type, participantId: person.id },
		direction: q.direction,
		currency: q.currency,
		rateType: q.rateType,
		// Omitted is every scope; the word is Outside projects (null).
		scope:
			q.scope === undefined
				? undefined
				: q.scope === OUTSIDE_PROJECTS
					? null
					: q.scope,
	};
	return thaw(
		await settleContext(
			caller.db,
			caller.principal.userId,
			input,
			caller.timeZone,
		),
	);
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Adds a person. An email that belongs to an account is answered with that
 * account only when the caller already shares expenses or a project with it;
 * any other gets a person with the typed email, exactly like an email with no
 * account ("protect", shadow-profile.service.ts).
 */
export async function addPerson(
	caller: Caller,
	input: { id?: string; name: string; email?: string },
) {
	const me = input.email
		? await caller.db.user.findUnique({
				where: { id: caller.principal.userId },
				select: { name: true },
			})
		: null;
	const result = await addShadow(
		caller.db,
		{ id: caller.principal.userId, name: me?.name ?? null },
		input,
		"protect",
	);
	if (result.kind === "account") {
		return {
			type: "user" as const,
			id: result.userId,
			name: result.name ?? input.name,
			email: input.email ?? null,
			existing: true,
		};
	}
	return {
		type: "shadow" as const,
		id: result.id,
		name: result.name,
		email: result.email,
		existing: false,
	};
}

export const renamePerson = (
	caller: Caller,
	input: z.infer<typeof renamePersonSchema>,
) => renameShadow(caller.db, caller.principal.userId, input);

export const createClaimLink = (caller: Caller, id: string) =>
	mintClaimLink(caller.db, caller.principal.userId, id);

export async function remindPerson(caller: Caller, person: PersonRef) {
	await new SettlementService(
		caller.db,
		caller.principal.userId,
	).sendBalanceReminder({
		participantType: person.type,
		participantId: person.id,
	});
	return { ok: true as const };
}
