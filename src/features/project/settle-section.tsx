"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { PersonTarget } from "~/components/actions/registry";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { PersonRow } from "~/components/rows/person-row";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { SettleUpDialog } from "~/components/settle-up-dialog";
import { FaceStack } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import {
	figureFor,
	lineIn,
	type Member,
	type PageView,
	type Summary,
} from "./types";

/** The group's fewest transfers (from the summary read). */
export function WhoPaysWhom({ summary, me }: { summary: Summary; me: string }) {
	const t = useTranslations("projectV2.summary");
	if (summary.transfers.length === 0)
		return <p className="text-fg-2 text-small">{t("even")}</p>;
	return (
		<RowList label={t("whoPaysWhom")}>
			{summary.transfers.map((x) => {
				const mine = x.from.key === me || x.to.key === me;
				const people = [x.from, x.to].map((p) => ({
					id: p.key,
					name: p.name,
					imageUrl: p.avatarUrl,
					isSelf: p.key === me,
				}));
				const title =
					x.from.key === me
						? t("youPay", { to: x.to.name })
						: t("pays", {
								from: x.from.name,
								to: x.to.key === me ? t("youObject") : x.to.name,
							});
				return (
					<Row
						// An empty trailing column keeps the money on the edge of the rows below (R27).
						actions={<span />}
						end={<Money value={x.amount} />}
						key={`${x.from.key}-${x.to.key}-${x.amount.currency}`}
						lead={<FaceStack people={people} />}
						sub={<RowSub parts={[mine ? t("betweenYou") : t("betweenThem")]} />}
						title={title}
					/>
				);
			})}
		</RowList>
	);
}

/** You and each person: your balance in this project, Settle up in the row menu. */
function YouAndEach({
	view,
	canRecord,
	onSettle,
}: {
	view: PageView;
	canRecord: boolean;
	onSettle: (m: Member) => void;
}) {
	const t = useTranslations("projectV2.summary");
	const router = useRouter();
	const others = view.members.filter((m) => !m.isMe);
	const handlers = {
		settle: (x: PersonTarget) => {
			const m = others.find((o) => o.id === x.id);
			if (m) onSettle(m);
		},
		profile: (x: PersonTarget) => {
			const m = others.find((o) => o.id === x.id);
			if (m) router.push(`/people/${m.participantType}/${m.participantId}`);
		},
	};
	return (
		<RowList label={t("youAndEach")}>
			{others.map((m) => {
				const target = { id: m.id, name: m.name };
				// Settle up only where something is open and you can record it.
				const live =
					canRecord && m.withMe.length > 0
						? handlers
						: { profile: handlers.profile };
				const zero = { minor: 0, currency: view.primaryCurrency };
				return (
					<ActionArea
						entity="person"
						handlers={live}
						key={m.id}
						target={target}
					>
						<PersonRow
							actions={
								<ActionMenu entity="person" handlers={live} target={target} />
							}
							person={{
								id: m.id,
								name: m.name,
								imageUrl: m.imageUrl,
								onRetrospend: m.onRetrospend,
								lastShared: t(`roles.${m.role}`),
								balance: lineIn(m.withMe, view.primaryCurrency) ?? zero,
								figure: figureFor("balance.person", view.id, m.id),
								href: `/people/${m.participantType}/${m.participantId}`,
							}}
						/>
					</ActionArea>
				);
			})}
		</RowList>
	);
}

/**
 * Settle up, below the spending (owner, Summary tab 2026-08-04): who pays
 * whom for the whole group, then you and each person with your balance in
 * this project. A row's menu settles with them (today's settle dialog until
 * 4D's sheet). Settle all records every one of your lines at once. Viewers
 * see the balances and record nothing.
 */
export function SettleSection({
	view,
	summary,
	me,
	onSettleAll,
}: {
	view: PageView;
	summary: Summary;
	me: string;
	onSettleAll: () => void;
}) {
	const t = useTranslations("projectV2.summary");
	const [settling, setSettling] = useState<Member | null>(null);
	const canRecord = view.myRole !== "VIEWER" && view.myRole != null;
	const open =
		canRecord && view.members.some((m) => !m.isMe && m.withMe.length > 0);
	return (
		<Section title={t("settleUp")}>
			<h3 className="text-fg text-body mt-2 mb-1 font-medium">
				{t("whoPaysWhom")}
			</h3>
			<WhoPaysWhom me={me} summary={summary} />
			<div className="mt-6 mb-1 flex items-center justify-between gap-2">
				<h3 className="text-fg text-body font-medium">{t("youAndEach")}</h3>
				{open ? (
					<Button kind="secondary" onClick={onSettleAll} size="sm">
						{t("settleAll")}
					</Button>
				) : null}
			</div>
			<YouAndEach canRecord={canRecord} onSettle={setSettling} view={view} />
			{settling ? (
				<SettleUpDialog
					onClose={() => setSettling(null)}
					open
					participantId={settling.participantId}
					participantType={settling.participantType}
					personAvatarUrl={settling.imageUrl}
					personName={settling.name}
					projectId={view.id}
				/>
			) : null}
		</Section>
	);
}
