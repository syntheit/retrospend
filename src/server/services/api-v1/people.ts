import type { CursorQuery, renamePersonSchema } from "@retrospend/api-contract";
import { OUTSIDE_PROJECTS } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { env } from "~/env";
import { signClaimToken } from "~/lib/claim-token";
import { getShadowInviteEmailTemplate } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import { canMintClaimLink } from "~/server/services/claim.service";
import { personPage } from "~/server/services/people/detail";
import { ledgerRows } from "~/server/services/people/ledger-rows";
import { peopleOverview } from "~/server/services/people/overview";
import {
	settleContext,
	type settleContextSchema,
} from "~/server/services/people/settle-context";
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
 * had their logic inline in the tRPC routers (people.createShadow,
 * people.updateShadow, claim.generateLink); it lives here for v1 and the
 * routers can call these.
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

const ledgerCursor = z.object({ before: z.iso.datetime({ offset: true }) });

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

/** An email that belongs to an account answers with that account; any other gets an invitation. */
export async function addPerson(
	caller: Caller,
	input: { name: string; email?: string },
) {
	if (input.email) {
		const account = await caller.db.user.findFirst({
			where: { email: { equals: input.email, mode: "insensitive" } },
			select: { id: true, name: true },
		});
		if (account) {
			return {
				type: "user" as const,
				id: account.id,
				name: account.name ?? input.name,
				email: input.email,
				existing: true,
			};
		}
	}
	const profile = await caller.db.shadowProfile.create({
		data: {
			name: input.name,
			email: input.email ?? null,
			createdById: caller.principal.userId,
		},
		select: { id: true, name: true, email: true },
	});
	if (input.email) await inviteByEmail(caller, input.name, input.email);
	return {
		type: "shadow" as const,
		id: profile.id,
		name: profile.name,
		email: profile.email,
		existing: false,
	};
}

/** Fire and forget, like the web: a mail failure never fails the add. */
async function inviteByEmail(caller: Caller, name: string, email: string) {
	const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
	if (!appUrl) return;
	const me = await caller.db.user.findUnique({
		where: { id: caller.principal.userId },
		select: { name: true },
	});
	const creator = me?.name ?? "Someone";
	const signupUrl = `${appUrl}/signup?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&invited=true`;
	void sendEmail(
		email,
		`${creator} invited you to Retrospend`,
		getShadowInviteEmailTemplate(creator, signupUrl),
	);
}

/** The shadow as the caller sees it (RLS), refused once it was linked to an account. */
async function openShadow(caller: Caller, id: string) {
	const shadow = await caller.db.shadowProfile.findUnique({
		where: { id },
		select: {
			id: true,
			name: true,
			claimedById: true,
			createdById: true,
			updatedAt: true,
		},
	});
	if (!shadow) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
	}
	if (shadow.claimedById) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This person has already been linked to an account",
		});
	}
	return shadow;
}

export async function renamePerson(
	caller: Caller,
	input: z.infer<typeof renamePersonSchema>,
) {
	const shadow = await openShadow(caller, input.id);
	// shadow_profile's write policy is creator-only: refuse here for a clear
	// error instead of a Postgres rejection.
	if (shadow.createdById !== caller.principal.userId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the person who added this contact can rename them",
		});
	}
	return caller.db.shadowProfile.update({
		where: { id: shadow.id },
		data: {
			name: input.name,
			...(input.email !== undefined ? { email: input.email } : {}),
		},
		select: { id: true, name: true, email: true },
	});
}

/**
 * A claim link grants the holder the person's identity and a membership in
 * every project they are in, so the caller must run all of them
 * (canMintClaimLink); the same check runs again when it is claimed.
 */
export async function createClaimLink(caller: Caller, id: string) {
	const shadow = await openShadow(caller, id);
	if (!(await canMintClaimLink(caller.db, caller.principal.userId, shadow))) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				"Only an editor or organizer of every project this person is in can generate a claim link",
		});
	}
	const token = signClaimToken(
		{
			shadowId: shadow.id,
			version: shadow.updatedAt.getTime(),
			issuerId: caller.principal.userId,
		},
		env.BETTER_AUTH_SECRET,
	);
	const baseUrl = env.PUBLIC_URL ?? env.NEXT_PUBLIC_APP_URL;
	return { url: `${baseUrl}/claim/${token}`, token, name: shadow.name };
}

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
