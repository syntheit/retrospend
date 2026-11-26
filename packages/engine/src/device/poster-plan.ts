import type { PosterRun } from "@retrospend/domain/recurring-post/poster";
import type { Reader } from "../port";
import { planPosterOver } from "../recurring-local";
import { readRepos } from "../repos";

// What the phone's poster asks of the store: the domain's plan of every due
// period of each template, over the rows as the last pull left them. Nothing
// is written here and no pending write is laid over the rows: a template that
// has an unsent or acked entry is the caller's to leave out (`skip`), because
// its pull has not come back.

export interface PosterTemplatePlan {
	readonly templateId: string;
	/** For the Sync issues row of an entry; never sent. */
	readonly title: string;
	readonly currency: string;
	/** `entries` is never empty: a template with nothing to post is left out. */
	readonly run: PosterRun;
}

export interface PosterPlansInput {
	readonly now: Date;
	/** The server's auto-post setting: off means the poster plans nothing. */
	readonly autoPost: boolean;
	/** Whether the account is protected; a read that fails must say yes. */
	readonly isProtected: () => Promise<boolean>;
	/** Templates left out: they have entries the phone has not seen back. */
	readonly skip: ReadonlySet<string>;
}

export async function planPosterIn(
	view: Reader,
	input: PosterPlansInput,
): Promise<readonly PosterTemplatePlan[]> {
	const r = readRepos(view);
	const plans: PosterTemplatePlan[] = [];
	for (const row of r.recurringTemplates.list()) {
		if (input.skip.has(row.id)) continue;
		const run = await planPosterOver(r, {
			templateId: row.id,
			now: input.now,
			autoPost: input.autoPost,
			isProtected: input.isProtected,
		});
		if (run.entries.length > 0)
			plans.push({
				templateId: row.id,
				title: row.name,
				currency: row.currency,
				run,
			});
	}
	return plans;
}
