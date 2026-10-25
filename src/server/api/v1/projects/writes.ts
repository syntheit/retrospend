import * as w from "~/server/services/api-v1/project-writes";
import { serve } from "../core/serve";
import { signedIn, type V1Context, v1 } from "../middleware";

const p = v1.projects;

const h = <I, R>(
	run: (caller: ReturnType<typeof signedIn>, input: I) => Promise<R>,
) =>
	serve(async ({ context, input }: { context: V1Context; input: I }) =>
		run(signedIn(context), input),
	);

/** The project writes, members, invite links and the paged expense list. */
export const projectWritesRouter = {
	create: p.create.handler(h(w.createProject)),
	update: p.update.handler(h(w.updateProject)),
	delete: p.delete.handler(h((c, input: { id: string }) => w.deleteProject(c, input.id))),
	setAnalyticsExclusion: p.setAnalyticsExclusion.handler(
		h((c, input: { id: string; exclude: boolean }) =>
			w.setAnalyticsExclusion(c, input.id, input.exclude),
		),
	),
	addMember: p.addMember.handler(h(w.addMember)),
	setMemberRole: p.setMemberRole.handler(h(w.setMemberRole)),
	setMemberDates: p.setMemberDates.handler(h(w.setMemberDates)),
	previewSetMemberDates: p.previewSetMemberDates.handler(h(w.previewMemberDates)),
	removeMember: p.removeMember.handler(h(w.removeMember)),
	transferOwnership: p.transferOwnership.handler(h(w.transferOwnership)),
	rebalanceable: p.rebalanceable.handler(h(w.listRebalanceable)),
	rebalance: p.rebalance.handler(h(w.rebalance)),
	previewRebalance: p.previewRebalance.handler(h(w.previewRebalance)),
	magicLinks: p.magicLinks.handler(
		h((c, input: { id: string }) => w.listMagicLinks(c, input.id)),
	),
	createMagicLink: p.createMagicLink.handler(h(w.createMagicLink)),
	revokeMagicLink: p.revokeMagicLink.handler(
		h((c, input: { id: string; linkId: string }) =>
			w.revokeMagicLink(c, input.id, input.linkId),
		),
	),
	resetMagicLink: p.resetMagicLink.handler(h(w.resetMagicLink)),
	expenses: p.expenses.handler(h(w.listExpenses)),
};
