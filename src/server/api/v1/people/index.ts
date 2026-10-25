import * as people from "~/server/services/api-v1/people";
import {
	EMAIL_CHECKS,
	emailCheckKey,
} from "~/server/services/shadow-profile.service";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";
import { enforceRateLimit } from "../rate-limit";

const p = v1.people;

export const peopleRouter = {
	list: p.list.handler(
		serve(({ context }) => people.listPeople(signedIn(context))),
	),
	get: p.get.handler(
		serve(({ context, input }) => people.readPerson(signedIn(context), input)),
	),
	ledger: p.ledger.handler(
		serve(({ context, input }) => {
			const { type, id, ...page } = input;
			return people.listPersonLedger(signedIn(context), { type, id }, page);
		}),
	),
	settle: p.settle.handler(
		serve(({ context, input }) => {
			const { type, id, ...query } = input;
			return people.readSettleContext(signedIn(context), { type, id }, query);
		}),
	),
	create: p.create.handler(
		serve(async ({ context, input }) => {
			const user = signedIn(context);
			// An email is a lookup against every account, so it is metered apart.
			if (input.email)
				await enforceRateLimit(
					emailCheckKey(user.principal.userId),
					EMAIL_CHECKS,
					context.resHeaders,
				);
			return people.addPerson(user, input);
		}),
	),
	rename: p.rename.handler(
		serve(({ context, input }) =>
			people.renamePerson(signedIn(context), input),
		),
	),
	claimLink: p.claimLink.handler(
		serve(({ context, input }) =>
			people.createClaimLink(signedIn(context), input.id),
		),
	),
	remind: p.remind.handler(
		serve(({ context, input }) =>
			people.remindPerson(signedIn(context), input),
		),
	),
};
