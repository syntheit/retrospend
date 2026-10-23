"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { PersonTarget } from "~/components/actions/registry";
import { Section } from "~/components/layout/section";
import { useRowDates } from "~/components/rows/dates";
import { PersonRow } from "~/components/rows/person-row";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { figureFor, lineIn, type Member, type PageView } from "./types";

/** "Member · since Oct 9 · left Oct 20": the role and the membership dates (RC-11). */
function useMemberLine() {
	const t = useTranslations("projectV2.people");
	const { short } = useRowDates();
	return (m: Member) =>
		[
			t(`roles.${m.role}`),
			m.joinedOn ? t("since", { date: short(m.joinedOn) }) : null,
			m.leftOn ? t("left", { date: short(m.leftOn) }) : null,
		]
			.filter(Boolean)
			.join(" · ");
}

/**
 * People: you first, then everyone with their role, membership dates and
 * your balance with them in this project. Add person and Members and
 * settings for editors; a row opens the person's page.
 */
export function PeoplePane({
	view,
	onAdd,
	onSettings,
}: {
	view: PageView;
	onAdd: () => void;
	onSettings: () => void;
}) {
	const t = useTranslations("projectV2.people");
	const router = useRouter();
	const line = useMemberLine();
	const editor = view.myRole === "ORGANIZER" || view.myRole === "EDITOR";
	const handlers = {
		profile: (x: PersonTarget) => {
			const m = view.members.find((o) => o.id === x.id);
			if (m) router.push(`/people/${m.participantType}/${m.participantId}`);
		},
	};
	return (
		<Section
			count={view.members.length}
			end={
				editor ? (
					<Button kind="secondary" onClick={onAdd} size="sm">
						<UserPlus aria-hidden="true" />
						{t("add")}
					</Button>
				) : undefined
			}
			id="people"
			title={t("title")}
		>
			<RowList label={t("title")}>
				{view.members.map((m) => {
					if (m.isMe)
						return (
							<Row
								key={m.id}
								lead={<Face imageUrl={m.imageUrl} name={m.name} size="md" />}
								sub={<RowSub parts={[line(m)]} />}
								title={m.name}
								titleEnd={
									<span className="text-fg-3 text-meta">{t("you")}</span>
								}
							/>
						);
					const target = { id: m.id, name: m.name };
					return (
						<ActionArea
							entity="person"
							handlers={handlers}
							key={m.id}
							target={target}
						>
							<PersonRow
								actions={
									<ActionMenu
										entity="person"
										handlers={handlers}
										target={target}
									/>
								}
								person={{
									id: m.id,
									name: m.name,
									imageUrl: m.imageUrl,
									onRetrospend: m.onRetrospend,
									lastShared: line(m),
									balance: lineIn(m.withMe, view.primaryCurrency) ?? {
										minor: 0,
										currency: view.primaryCurrency,
									},
									figure: figureFor("balance.person", view.id, m.id),
									href: `/people/${m.participantType}/${m.participantId}`,
								}}
							/>
						</ActionArea>
					);
				})}
			</RowList>
			{editor ? (
				<Button className="mt-2" kind="ghost" onClick={onSettings} size="sm">
					{t("membersAndSettings")}
				</Button>
			) : null}
		</Section>
	);
}
