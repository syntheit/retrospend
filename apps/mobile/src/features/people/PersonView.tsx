import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Share, View } from "react-native";
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
import { Menu } from "@/ui/Menu";
import { PaneBar } from "@/ui/PaneBar";
import { Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { isApproximate, sideOf } from "./groups";
import { useNetHeroText } from "./NetAmount";
import { type PersonAction, PersonActions } from "./PersonActions";
import { PersonLedger } from "./PersonLedger";
import { PersonNeeds } from "./PersonNeeds";
import { ScopeRow } from "./PersonSections";
import { type ReviewNeed, ReviewSheet } from "./ReviewSheet";
import type { PersonRef } from "./source";
import { useLedgerMore } from "./useLedgerMore";
import { usePerson } from "./usePeople";
import { usePersonExport } from "./useScopedExport";

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
	const tc = useTranslations("mobile.common");
	const more = useTranslations("mobile.activity")("overflow");
	const overflow = usePersonExport(person);
	const format = useFormatter();
	const money = useMoneyText();
	const heroText = useNetHeroText();
	const faces = useFaces();
	const toast = useToast();
	const add = useOptionalAddEntry();
	const { api } = useSession();
	const { color, size, space } = useTheme();
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
				<SkeletonRows />
			</Screen>
		);
	if (state.status === "error") {
		return (
			<Screen>
				<EmptyState
					actionLabel={tc("retry")}
					detail={t("errorDetail")}
					onAction={() => void reload()}
					title={t("error")}
				/>
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
	const remindable = side === "owesYou";
	const net = open.length > 1;
	const handle = identity.onRetrospend
		? identity.username
			? `@${identity.username}`
			: null
		: t("notOnRetrospend");
	// One line, as the mockup: the handle first, then since, expenses, projects.
	const meta = [
		handle,
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
		// Someone not on Retrospend has no app to nudge: the share sheet opens
		// a message you send yourself.
		if (!identity.onRetrospend) {
			const first = identity.name.split(/\s+/)[0] ?? identity.name;
			try {
				await Share.share({
					message: t("remindMessage", {
						name: first,
						amount: open
							.map((p) =>
								money({
									minor: Math.abs(p.amount.minor),
									currency: p.amount.currency,
								}),
							)
							.join(" + "),
					}),
				});
			} catch {
				toast.show({ message: t("remindFailed") });
			}
			return;
		}
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
						icon: "Banknote" as const,
						label: t("settleUp"),
						onPress: () => setSettling(true),
						primary: true,
					},
				]),
		...(remindable
			? [
					{
						id: "remind",
						icon: "Bell" as const,
						label: t("remind"),
						onPress: remind,
					},
				]
			: []),
		...(add
			? [
					{
						id: "expense",
						icon: "Plus" as const,
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
				<PaneBar
					title={identity.name}
					trailing={
						<Menu
							accessibilityLabel={more}
							icon
							items={overflow}
							label={more}
						/>
					}
				/>
			) : (
				<Stack.Screen
					options={{
						title: identity.name,
						headerLargeTitle: false,
						headerRight: () => (
							<Menu
								accessibilityLabel={more}
								icon
								items={overflow}
								label={more}
							/>
						),
					}}
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
					{face ? (
						identity.onRetrospend ? (
							<Avatar face={face} size="xxl" />
						) : (
							<View
								style={{
									borderRadius: size.avatar.xxl,
									borderWidth: 1,
									borderStyle: "dashed",
									borderColor: color.lineStrong,
									padding: space[1],
								}}
							>
								<Avatar face={face} size="xxl" />
							</View>
						)
					) : null}
					<Text
						// Wraps on words (two lines); a long word shrinks, never splits.
						accessibilityRole="header"
						adjustsFontSizeToFit
						minimumFontScale={0.6}
						numberOfLines={2}
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
							labelTone="hero"
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
							subTone="fg3"
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

			<PersonLedger
				complete={
					ledger.rows !== null
						? !ledger.hasMore
						: page.rowCount <= page.rows.length
				}
				firstName={identity.name.split(/\s+/)[0] ?? identity.name}
				payments={page.payments}
				rows={rows}
			/>
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
