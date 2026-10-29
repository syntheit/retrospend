import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { ConfirmSheet } from "@/features/settle/ConfirmSheet";
import { SettleSheet } from "@/features/settle/SettleSheet";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { EmptyState } from "@/ui/EmptyState";
import { Hero } from "@/ui/Hero";
import { LinkButton, ListGroup, SectionHeader, StaleNote } from "@/ui/List";
import { PaneBar } from "@/ui/PaneBar";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { isApproximate, sideOf } from "./groups";
import { useNetHeroText } from "./NetAmount";
import { type PersonAction, PersonActions } from "./PersonActions";
import { PersonNeeds } from "./PersonNeeds";
import { PaymentRow, ScopeRow, SharedRow } from "./PersonSections";
import { type ReviewNeed, ReviewSheet } from "./ReviewSheet";
import type { PersonRef } from "./source";
import { useLedgerMore } from "./useLedgerMore";
import { usePerson } from "./usePeople";

/**
 * One person: who they are, the balance (never netted across currencies: the
 * parts are listed), the actions, what waits for you, what is open per
 * project, the payments, and the shared expenses between you. Shown as a
 * screen on a phone and as the detail pane of People on iPad and wide
 * Android windows.
 */
export function PersonView({
	person,
	startSettling = false,
}: {
	person: PersonRef;
	/** A link that says "settle up" (a reminder, a deep link) opens the sheet. */
	startSettling?: boolean;
}) {
	const t = useTranslations("mobile.person");
	const format = useFormatter();
	const money = useMoneyText();
	const heroText = useNetHeroText();
	const faces = useFaces();
	const toast = useToast();
	const add = useOptionalAddEntry();
	const { api } = useSession();
	const { space } = useTheme();
	const { listDetail } = useLayoutClass();
	const { state, reload } = usePerson(person);
	const [settling, setSettling] = useState(startSettling);
	const [confirming, setConfirming] = useState<{
		id: string;
		amount: { minor: number; currency: string };
	} | null>(null);
	const [reviewing, setReviewing] = useState<ReviewNeed | null>(null);
	const ledger = useLedgerMore(person);

	// The same screen opened again by a "settle up" link.
	useEffect(() => {
		if (startSettling) setSettling(true);
	}, [startSettling]);

	if (state.status === "loading")
		return (
			<Screen>
				<EmptyState title="" />
			</Screen>
		);
	if (state.status === "error") {
		return (
			<Screen>
				<EmptyState detail={t("errorDetail")} title={t("error")} />
			</Screen>
		);
	}

	const page = state.data;
	const identity = page.person;
	const [face] = faces([
		{ key: identity.key, name: identity.name, imageUrl: identity.imageUrl },
	]);
	const side = sideOf(page.net, page.parts);
	const open = page.parts.filter((p) => p.amount.minor !== 0);
	const rows = ledger.rows ?? page.rows;
	const remindable = identity.onRetrospend && side === "owesYou";
	const net = open.length > 1;
	const meta = [
		identity.username ? `@${identity.username}` : null,
		page.stats.since
			? t("since", {
					date: format.dateTime(new Date(`${page.stats.since}T12:00:00`), {
						month: "short",
						year: "numeric",
					}),
				})
			: null,
		t("expenseCount", { count: page.stats.expenses }),
		t("projectCount", { count: page.stats.projects }),
	].filter(Boolean);

	async function remind() {
		try {
			await api?.people.remind(
				{ type: person.type, id: person.id },
				{ context: { idempotencyKey: newClientId() } },
			);
			toast.show({ message: t("reminded") });
		} catch {
			toast.show({ message: t("remindFailed") });
		}
	}

	const actions: PersonAction[] = [
		...(page.settled.nothingShared
			? []
			: [
					{
						id: "settle",
						glyph: "Banknote" as const,
						label: t("settleUp"),
						onPress: () => setSettling(true),
						primary: true,
					},
				]),
		...(remindable
			? [
					{
						id: "remind",
						glyph: "Bell" as const,
						label: t("remind"),
						onPress: remind,
					},
				]
			: []),
		...(add
			? [
					{
						id: "expense",
						glyph: "Plus" as const,
						label: t("expense"),
						onPress: () =>
							add.open("expense", {
								mode: "expense",
								withKeys: [page.person.key],
							}),
					},
				]
			: []),
	];

	return (
		<Screen flush onRefresh={reload}>
			{listDetail ? (
				<PaneBar title={identity.name} />
			) : (
				<Stack.Screen
					options={{ title: identity.name, headerLargeTitle: false }}
				/>
			)}
			<StaleNote since={state.staleSince} />
			<View style={{ gap: space[4], paddingTop: space[4] }}>
				<View
					style={{
						alignItems: "center",
						gap: space[2],
						paddingHorizontal: space[4],
					}}
				>
					{face ? <Avatar face={face} size="xxl" /> : null}
					<Text
						accessibilityRole="header"
						style={{ textAlign: "center" }}
						variant="title"
					>
						{identity.name}
					</Text>
					<Text style={{ textAlign: "center" }} tone="fg2" variant="small">
						{meta.join(" · ")}
					</Text>
				</View>

				<View style={{ paddingHorizontal: space[4] }}>
					{side === "settled" ? (
						<Text style={{ textAlign: "center" }} tone="fg2" variant="body">
							{t("settled")}
						</Text>
					) : (
						<Hero
							align="center"
							label={
								side === "owesYou"
									? net
										? t("owesYouNet")
										: t("owesYou")
									: net
										? t("youOweThemNet")
										: t("youOweThem")
							}
							sub={
								open.length > 1 ||
								(open.length === 1 && isApproximate(open, page.home))
									? open
											.map((p) =>
												money({
													minor: Math.abs(p.amount.minor),
													currency: p.amount.currency,
												}),
											)
											.join(" · ")
									: undefined
							}
							tone={side === "owesYou" ? "positive" : "fg"}
							value={heroText(page.net, page.parts, page.home)}
						/>
					)}
				</View>

				<PersonActions actions={actions} />

				<PersonNeeds
					onConfirm={setConfirming}
					onReview={setReviewing}
					page={page}
				/>
			</View>

			{page.scopes.length > 0 ? (
				<>
					<SectionHeader title={t("projects")} />
					<ListGroup>
						{page.scopes.map((scope) => (
							<ScopeRow key={scope.project?.id ?? "outside"} scope={scope} />
						))}
					</ListGroup>
				</>
			) : null}

			{page.payments.length > 0 ? (
				<>
					<SectionHeader title={t("payments")} />
					<ListGroup>
						{page.payments.map((payment) => (
							<PaymentRow key={payment.id} payment={payment} />
						))}
					</ListGroup>
				</>
			) : null}

			<SectionHeader title={t("between")} />
			{rows.length === 0 ? (
				<Text style={{ paddingHorizontal: space[4] }} tone="fg2" variant="body">
					{t("betweenEmpty")}
				</Text>
			) : (
				<ListGroup>
					{rows.map((row) => (
						<SharedRow key={row.id} row={row} />
					))}
				</ListGroup>
			)}
			{ledger.rows === null && page.rowCount > page.rows.length ? (
				<LinkButton
					label={t("showAll", { count: page.rowCount })}
					onPress={ledger.loadAll}
				/>
			) : null}
			{ledger.hasMore ? (
				<LinkButton label={t("showMore")} onPress={ledger.loadMore} />
			) : null}

			{confirming ? (
				<ConfirmSheet
					onClose={() => setConfirming(null)}
					onDone={reload}
					payment={confirming}
					person={identity}
					visible
				/>
			) : null}
			{reviewing ? (
				<ReviewSheet
					need={reviewing}
					onClose={() => setReviewing(null)}
					onDone={reload}
					person={identity}
					row={page.rows.find((r) => r.id === reviewing.id)}
					visible
				/>
			) : null}
			<SettleSheet
				onClose={() => setSettling(false)}
				onDone={reload}
				person={identity}
				visible={settling}
			/>
		</Screen>
	);
}
