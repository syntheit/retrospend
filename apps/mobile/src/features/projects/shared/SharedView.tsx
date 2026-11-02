import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { Menu } from "@/ui/Menu";
import { MoneyAmount } from "@/ui/Money";
import { usePaneEnter } from "@/ui/motion";
import { Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { UnderlineTabs } from "@/ui/UnderlineTabs";
import { ProjectExpenseDays } from "../ProjectExpenses";
import { ProjectHeader, ProjectTitle } from "../ProjectHeader";
import { ProjectPeopleTab } from "../ProjectPeopleTab";
import type { ProjectPage } from "../source";
import { createGuestApi } from "./guestApi";
import type { GuestRecord, SharedMode } from "./sharedAccess";

type Tab = "expenses" | "summary" | "people";
const TAB_ORDER: Tab[] = ["expenses", "summary", "people"];

type Read =
	| { status: "loading" }
	| { status: "ready"; page: ProjectPage }
	| { status: "private" }
	| { status: "expired" }
	| { status: "error" };

/** The page for a guest, a viewer link or the public (the server decides what each may see). */
function useSharedPage(
	baseUrl: string,
	id: string,
	mode: SharedMode,
	record: GuestRecord | null,
) {
	const [read, setRead] = useState<Read>({ status: "loading" });
	const [refreshing, setRefreshing] = useState(false);
	const api = useMemo(
		() =>
			createGuestApi(baseUrl, {
				token: mode === "guest" ? record?.token : null,
				viewerLink: mode === "viewer" ? record?.viewerLink : null,
			}),
		[baseUrl, mode, record?.token, record?.viewerLink],
	);
	const load = useCallback(async () => {
		try {
			if (mode === "public") {
				const page = await api.publicPage(id);
				setRead(page ? { status: "ready", page } : { status: "private" });
				return;
			}
			setRead({ status: "ready", page: await api.sharedPage(id) });
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (mode !== "public" && (code === "UNAUTHORIZED" || code === "FORBIDDEN"))
				setRead({ status: "expired" });
			else setRead({ status: "error" });
		}
	}, [api, id, mode]);
	useEffect(() => {
		setRead({ status: "loading" });
		void load();
	}, [load]);
	const reload = useCallback(async () => {
		setRefreshing(true);
		await load();
		setRefreshing(false);
	}, [load]);
	return { read, reload, refreshing };
}

/** Where the project spent: each category with the group's total, and yours when you are in it. */
function SharedSummary({ page, mine }: { page: ProjectPage; mine: boolean }) {
	const t = useTranslations("mobile.projects.shared");
	const money = useMoneyText();
	const { space, size } = useTheme();
	const rows = page.byCategory.filter((c) => c.group.length > 0);
	if (rows.length === 0)
		return (
			<View style={{ paddingTop: space[4] }}>
				<EmptyState title={t("noSummary")} />
			</View>
		);
	return (
		<View style={{ paddingTop: space[4], gap: space[2] }}>
			<Text
				accessibilityRole="header"
				style={{ paddingHorizontal: size.gutter.phone }}
				tone="fg2"
				variant="small"
				weight="medium"
			>
				{t("byCategory")}
			</Text>
			<ListGroup>
				{rows.map((row) => (
					<ListRow
						accessibilityLabel={[
							row.name ?? t("uncategorized"),
							...row.group.map((l) => money(l)),
						].join(", ")}
						end={
							<View style={{ alignItems: "flex-end" }}>
								{row.group.map((line) => (
									<MoneyAmount key={line.currency} value={line} />
								))}
								{mine
									? row.mine.map((line) => (
											<Text
												key={line.currency}
												numberOfLines={1}
												tone="fg3"
												variant="meta"
											>
												{t("yours", { amount: money(line) })}
											</Text>
										))
									: null}
							</View>
						}
						key={row.id ?? "none"}
						title={row.name ?? t("uncategorized")}
					/>
				))}
			</ListGroup>
		</View>
	);
}

/**
 * A project read without a seat in it: the same header, hero and tabs as a
 * member's, read only. A guest sees their own share and the people; a viewer
 * link and the public never see balances, and the public has no People tab.
 * Adding expenses is on the web page for now.
 */
export function SharedView({
	baseUrl,
	projectId,
	mode,
	record,
	name,
	onForget,
	onExpired,
}: {
	baseUrl: string;
	projectId: string;
	mode: SharedMode;
	record: GuestRecord | null;
	name?: string;
	/** Forget this project on this phone (guest and viewer). */
	onForget: () => void;
	/** The session or link stopped working. */
	onExpired: () => void;
}) {
	const t = useTranslations("mobile.projects");
	const ts = useTranslations("mobile.projects.shared");
	const tc = useTranslations("mobile.common");
	const more = useTranslations("mobile.activity")("overflow");
	const { space, size } = useTheme();
	const { read, reload, refreshing } = useSharedPage(
		baseUrl,
		projectId,
		mode,
		record,
	);
	const [tab, setTab] = useState<Tab>("expenses");
	const paneEnter = usePaneEnter(TAB_ORDER.indexOf(tab));
	const page = read.status === "ready" ? read.page : null;
	const expired = read.status === "expired";
	useEffect(() => {
		if (expired) onExpired();
	}, [expired, onExpired]);

	const upgrade = () =>
		void WebBrowser.openBrowserAsync(
			`${baseUrl.replace(/\/+$/, "")}/signup?upgrade=true${
				record?.name ? `&name=${encodeURIComponent(record.name)}` : ""
			}`,
		);

	if (read.status === "loading" || expired) {
		return (
			<Screen>
				<Stack.Screen
					options={{ title: name ?? "", headerLargeTitle: false }}
				/>
				<SkeletonRows />
			</Screen>
		);
	}
	if (!page) {
		const privateProject = read.status === "private";
		return (
			<Screen>
				<Stack.Screen
					options={{ title: name ?? "", headerLargeTitle: false }}
				/>
				<EmptyState
					actionLabel={privateProject ? undefined : tc("retry")}
					detail={privateProject ? ts("privateHint") : ts("errorHint")}
					onAction={privateProject ? undefined : () => void reload()}
					title={privateProject ? ts("privateTitle") : ts("errorTitle")}
				/>
			</Screen>
		);
	}

	const showPeople = mode === "guest" && !page.solo;
	const tabs: { value: Tab; label: string }[] = [
		{ value: "expenses", label: t("tab.expenses") },
		{ value: "summary", label: t("tab.summary") },
		...(showPeople ? [{ value: "people" as const, label: t("tab.people") }] : []),
	];
	const shown: Tab = tab === "people" && !showPeople ? "expenses" : tab;
	const notice =
		mode === "guest"
			? ts("noticeGuest", { name: record?.name ?? "" })
			: mode === "viewer"
				? ts("noticeViewer")
				: ts("noticePublic");
	const forget = [
		{
			id: "forget",
			label: ts("forget"),
			destructive: true,
			onPress: onForget,
		},
	];

	return (
		<Screen flush onRefresh={() => void reload()} refreshing={refreshing}>
			<Stack.Screen
				options={{
					title: page.name,
					headerLargeTitle: false,
					headerTitle: () => <ProjectTitle page={page} />,
					headerRight: () =>
						mode === "public" ? null : (
							<Menu accessibilityLabel={more} icon items={forget} label={more} />
						),
				}}
			/>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[3],
					paddingHorizontal: size.gutter.phone,
					paddingVertical: space[2],
				}}
			>
				<Text style={{ flex: 1 }} tone="fg2" variant="small">
					{notice}
				</Text>
				{mode === "public" && !record ? null : (
					<Button
						label={ts("createAccount")}
						onPress={upgrade}
						size="small"
						variant="outlined"
					/>
				)}
			</View>
			<ProjectHeader
				page={page}
				pane={false}
				tabs={
					<UnderlineTabs
						accessibilityLabel={t("tabs")}
						onChange={setTab}
						tabs={tabs}
						value={shown}
					/>
				}
			/>
			<Animated.View entering={paneEnter} key={shown}>
				{shown === "expenses" ? (
					page.expenses.length === 0 ? (
						<EmptyState title={t("noExpenses")} />
					) : (
						<ProjectExpenseDays expenses={page.expenses} solo={page.solo} />
					)
				) : shown === "summary" ? (
					<SharedSummary mine={mode === "guest"} page={page} />
				) : (
					<ProjectPeopleTab members={page.members} today={page.today} />
				)}
			</Animated.View>
		</Screen>
	);
}
