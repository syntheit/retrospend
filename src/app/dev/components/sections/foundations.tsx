"use client";

import { Ellipsis, Plus } from "lucide-react";
import { PageHeader } from "~/components/layout/page-header";
import { Section } from "~/components/layout/section";
import { SummaryLine } from "~/components/layout/summary-line";
import { Toolbar } from "~/components/layout/toolbar";
import { Money } from "~/components/money/money";
import { Face, FaceStack } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { PageTabs } from "~/components/ui/page-tabs";
import { Segmented } from "~/components/ui/segmented";
import { ME, m, P } from "../fixtures/rows";
import { Pair, Spec, States } from "../spec";

/** Sample copy shown inside the samples: fixtures, like the numbers. */
export const S = {
	colors: "Color. One job each. Brand and accent never carry money meaning.",
	series:
		"Series 1 to 8: charts and account groups, in order. series-1 is the accent.",
	avatars: "Avatar colors: the same hues, darker, so white initials pass AA.",
	categories:
		"Category 1 to 21: charts of categories and category glyphs only.",
	type: "Type. DM Sans. Nothing under 12px.",
	scale:
		"Space 4, 8, 12, 16, 24, 32, 48. Radius 8 controls, 12 panels and sheets, 999 chips.",
	projects: "Projects",
	newProject: "New project",
	more: "More",
	search: "Search projects",
	active: "Active",
	archived: "Archived",
	owe: "Overall, people owe you",
	content: "Section content goes here. Flat: heading, content, space.",
	seeAll: "See all",
	filter: "Filter projects",
	photo: "Profile picture (on Retrospend)",
	initials: "Initials (not on Retrospend)",
	sizes: "Sizes: xs 22, sm 24, 32, md 40, lg 48",
	stack: "Stack, 3 people",
	payer: "Payer first (accent ring)",
	overflow: "Overflow +N (max 4)",
	small: "Small (sm)",
	names: "Names mode",
	expenses: "Expenses",
	recurring: "Recurring",
	whoPaid: "Who paid what",
	paid: "Paid",
	share: "Share",
	endSlot: "A control at the end of the heading row instead of the link.",
};
function Structure({ phone }: { phone?: boolean }) {
	return (
		<>
			<PageHeader
				overflow={
					<Button aria-label={S.more} icon kind="ghost">
						<Ellipsis />
					</Button>
				}
				primary={
					phone ? undefined : (
						<Button kind="primary">
							<Plus />
							{S.newProject}
						</Button>
					)
				}
				title={S.projects}
			/>
			<Toolbar
				label={S.filter}
				search={
					<Input
						aria-label={S.search}
						className="h-ctl w-60"
						placeholder={S.search}
					/>
				}
			>
				<FilterChips label={S.filter}>
					<FilterChip selected>{S.active}</FilterChip>
					{!phone && <FilterChip>{S.archived}</FilterChip>}
				</FilterChips>
			</Toolbar>
			<SummaryLine
				items={[
					{ key: "owe", label: S.owe, value: <Money value={m("1663643")} /> },
				]}
			/>
			<Section
				action={phone ? undefined : { label: S.seeAll, href: "#structure" }}
				count={phone ? undefined : 2}
				title={S.active}
			>
				<div className="text-fg-2 text-small">{S.content}</div>
			</Section>
			<Section
				end={
					<Segmented
						label={S.whoPaid}
						onChange={() => undefined}
						options={[
							{ value: "paid", label: S.paid },
							{ value: "share", label: S.share },
						]}
						value="paid"
					/>
				}
				title={S.whoPaid}
			>
				<div className="text-fg-2 text-small">{S.endSlot}</div>
			</Section>
		</>
	);
}

export function StructureSection() {
	return (
		<Spec id="structure">
			<Pair desktop={<Structure />} phone={<Structure phone />} />
		</Spec>
	);
}

export function AvatarSection() {
	const all = [ME, P.lucia, P.martin, P.paz, P.juan, P.tomas];
	return (
		<Spec id="avatar">
			<States
				items={[
					[
						S.photo,
						<span className="flex items-center gap-3" key="a">
							<Face name={P.lucia.name} size="lg" />
							<Face name={P.martin.name} size="md" />
							<Face name={ME.name} />
						</span>,
					],
					[
						S.initials,
						<span className="flex items-center gap-3" key="b">
							<Face name={P.paz.name} size="lg" />
							<Face name={P.juan.name} size="md" />
							<Face name={P.juan.name} />
						</span>,
					],
					[
						S.sizes,
						<span className="flex items-center gap-3" key="c">
							{(["xs", "sm", "default", "md", "lg"] as const).map((z) => (
								<Face key={z} name={P.lucia.name} size={z} />
							))}
						</span>,
					],
				]}
			/>
			<States
				className="mt-6"
				items={[
					[S.stack, <FaceStack key="s" people={[P.lucia, P.martin, P.paz]} />],
					[
						S.payer,
						<FaceStack
							key="p"
							payerId="lucia"
							people={[ME, { ...P.lucia, share: m("6250") }, P.paz]}
						/>,
					],
					[S.overflow, <FaceStack key="o" people={all} />],
					[
						S.small,
						<FaceStack
							key="m"
							people={[P.lucia, P.martin, P.paz, P.juan]}
							size="sm"
						/>,
					],
					[
						S.names,
						<FaceStack key="n" names people={[P.lucia, P.martin, P.paz]} />,
					],
				]}
			/>
		</Spec>
	);
}

export function PageTabsSection() {
	const items = [
		{ id: "e", label: S.expenses, href: "#pagetabs" },
		{ id: "r", label: S.recurring, href: "#pagetabs", count: 11 },
	];
	return (
		<Spec id="pagetabs">
			<Pair
				desktop={<PageTabs current="e" items={items} />}
				phone={<PageTabs current="r" items={items} />}
			/>
		</Spec>
	);
}
