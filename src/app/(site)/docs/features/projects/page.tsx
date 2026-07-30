import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Callout } from "../../_components/callout"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Projects",
	description: "Group shared expenses into a named project — with budgets, billing periods, and participant roles.",
}

const slug = "features/projects"

export default function ProjectsPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Projects</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Projects are containers for organizing shared expenses. Use them for a vacation,
					a household, a group gift, or any situation where multiple people share costs over time.
				</p>
			</div>

			<h2 id="how-projects-work" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				How projects work
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				A project is a named container for expenses — nothing more, nothing less. There are no fixed
				types. A solo project is one where you are the only participant. An ongoing project is one
				where you use billing periods to segment time. A one-time purchase is just a project you
				archive when the expense is settled. The features (billing periods, budgets, roles, sharing)
				are there when you need them; you do not have to use any of them.
			</p>

			<h2 id="creating-a-project" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Creating a Project
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Fields when creating a project:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Name</strong>: what the project is called.</li>
				<li><strong>Image</strong> (optional): displayed as a cover photo in the project header and in project lists.</li>
				<li><strong>Default currency</strong>: the currency used for balances and summaries.</li>
				<li><strong>Budget</strong> (optional): a spending cap for the project.</li>
				<li><strong>Description</strong>: a short note about the project&apos;s purpose.</li>
			</ul>

			<h2 id="participants" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Participants
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Each participant has a role that controls what they can do:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Owner</strong>: Full control. Can edit the project, manage participants, close billing periods, and delete the project.</li>
				<li><strong>Editor</strong>: Can add and edit expenses, but cannot manage participants or project settings.</li>
				<li><strong>Contributor</strong>: Can add expenses but cannot edit others&apos; expenses.</li>
				<li><strong>Viewer</strong>: Read-only access. Can see expenses and balances but cannot add or change anything.</li>
			</ul>

			<h2 id="billing-periods" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Billing Periods
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				Billing periods divide a project&apos;s timeline into segments. Each period tracks its own
				expenses and balances. Frequencies: Weekly, Bi-weekly, Monthly, or Custom. You can close
				a period and settle up before starting the next one.
			</p>
			<Callout variant="tip">
				For roommates, use monthly billing periods to settle up at the end of each month.
			</Callout>

			<h2 id="budgets-and-categories" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Budgets and Categories
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Each project can have its own budget. The project detail page shows a category breakdown
				of spending within the project, separate from your personal budget.
			</p>

			<h2 id="activity-feed" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Activity Feed
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Every project has an activity feed that logs all changes: expenses added, amounts edited,
				participants joined, settlements recorded. This is the audit trail for the group.
			</p>

			<h2 id="sharing" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Sharing
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Invite others with a shareable link. Each link includes a QR code for easy sharing in
				person. You can configure the default role for new participants joining via the link.
			</p>

			<h2 id="archiving" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Archiving
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				Archive a project when it&apos;s done. Archived projects are hidden from the main list
				but remain accessible. You can restore an archived project at any time.
			</p>
			<Callout variant="info" title="Projects are optional">
				You don&apos;t need a project to split an expense. Quick splits work without one.
				Both project-based and standalone splits feed into the same per-person balance.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
