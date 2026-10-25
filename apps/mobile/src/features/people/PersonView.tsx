import { Button } from "@expo/ui";
import { Stack } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useFaces } from "@/features/read/faces";
import { LinkButton, SectionHeader, StaleNote } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { SettleSheet } from "@/features/settle/SettleSheet";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { EmptyState } from "@/ui/EmptyState";
import { NativeHost } from "@/ui/NativeHost";
import { Screen } from "@/ui/Screen";
import { useToast } from "@/ui/Toast";
import { isApproximate, sideOf } from "./groups";
import { NetAmount } from "./NetAmount";
import { PaymentRow, ScopeRow, SharedRow } from "./PersonSections";
import type { PersonPage, PersonRef } from "./source";
import { useLedgerMore } from "./useLedgerMore";
import { usePerson } from "./usePeople";

function Needs({ page }: { page: PersonPage }) {
	const t = useTranslations("mobile.home.needs");
	const { color, space, type } = useTheme();
	if (page.needs.length === 0) return null;
	const first = page.person.name.split(/\s+/)[0] ?? "";
	return (
		<View style={{ gap: space[1], paddingHorizontal: space[4] }}>
			{page.needs.map((need) => (
				<Text
					key={`${need.kind}:${need.id}`}
					style={{
						color: color.attentionText,
						fontSize: type.body.size,
						fontWeight: "500",
					}}
				>
					{need.kind === "confirmPayment"
						? t("payment_confirm", { name: first })
						: t("split_review", { name: first, title: need.title })}
				</Text>
			))}
		</View>
	);
}

/**
 * One person: the balance (never netted across currencies: the parts are
 * listed), Settle up, what is open per project, the payments, and the shared
 * expenses between you. Shown as a screen on a phone and as the detail pane
 * of People on iPad and wide Android windows.
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
	const faces = useFaces();
	const toast = useToast();
	const { api } = useSession();
	const { color, space, type } = useTheme();
	const { state, reload } = usePerson(person);
	const [settling, setSettling] = useState(startSettling);
	const ledger = useLedgerMore(person);

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

	return (
		<Screen flush>
			<Stack.Screen
				options={{ title: identity.name, headerLargeTitle: false }}
			/>
			<StaleNote since={state.staleSince} />
			<View style={{ gap: space[2], padding: space[4] }}>
				{face ? <Avatar face={face} size="lg" /> : null}
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{side === "owesYou"
						? t("owesYou")
						: side === "youOwe"
							? t("youOweThem")
							: t("settled")}
				</Text>
				{side === "settled" ? null : (
					<NetAmount
						align="left"
						home={page.home}
						net={page.net}
						parts={page.parts}
						size="hero"
						tone={side === "owesYou" ? "positive" : "default"}
					/>
				)}
				{open.length > 1 ||
				(open.length === 1 && isApproximate(open, page.home)) ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{open
							.map((p) =>
								money({
									minor: Math.abs(p.amount.minor),
									currency: p.amount.currency,
								}),
							)
							.join(" · ")}
					</Text>
				) : null}
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{page.stats.since
						? t("stats", {
								date: format.dateTime(
									new Date(`${page.stats.since}T12:00:00`),
									{
										month: "long",
										year: "numeric",
									},
								),
								expenses: page.stats.expenses,
								projects: page.stats.projects,
							})
						: t("statsNoDate", {
								expenses: page.stats.expenses,
								projects: page.stats.projects,
							})}
				</Text>
				<View
					style={{ flexDirection: "row", gap: space[3], paddingTop: space[2] }}
				>
					{page.settled.nothingShared ? null : (
						<NativeHost>
							<Button label={t("settleUp")} onPress={() => setSettling(true)} />
						</NativeHost>
					)}
					{remindable ? (
						<NativeHost>
							<Button label={t("remind")} onPress={remind} variant="outlined" />
						</NativeHost>
					) : null}
				</View>
			</View>

			<Needs page={page} />

			{page.scopes.length > 0 ? (
				<>
					<SectionHeader title={t("projects")} />
					{page.scopes.map((scope) => (
						<ScopeRow key={scope.project?.id ?? "outside"} scope={scope} />
					))}
				</>
			) : null}

			{page.payments.length > 0 ? (
				<>
					<SectionHeader title={t("payments")} />
					{page.payments.map((payment) => (
						<PaymentRow key={payment.id} payment={payment} />
					))}
				</>
			) : null}

			<SectionHeader title={t("between")} />
			{rows.length === 0 ? (
				<Text
					style={{
						color: color.fg2,
						fontSize: type.body.size,
						paddingHorizontal: space[4],
					}}
				>
					{t("betweenEmpty")}
				</Text>
			) : (
				rows.map((row) => <SharedRow key={row.id} row={row} />)
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

			<SettleSheet
				onClose={() => setSettling(false)}
				onDone={reload}
				person={identity}
				visible={settling}
			/>
		</Screen>
	);
}
