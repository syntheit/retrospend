import * as people from "~/server/services/api-v1/people";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const p = v1.people;

export const peopleRouter = {
	list: p.list.handler(serve(({ context }) => people.listPeople(signedIn(context)))),
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
		serve(({ context, input }) => people.addPerson(signedIn(context), input)),
	),
	rename: p.rename.handler(
		serve(({ context, input }) => people.renamePerson(signedIn(context), input)),
	),
	claimLink: p.claimLink.handler(
		serve(({ context, input }) =>
			people.createClaimLink(signedIn(context), input.id),
		),
	),
	remind: p.remind.handler(
		serve(({ context, input }) => people.remindPerson(signedIn(context), input)),
	),
};
