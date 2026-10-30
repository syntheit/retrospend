import { useState } from "react";
import { ScrollView } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { LinkButton, ListGroup, ListRow } from "@/ui/List";
import { StatusText, type StatusTone } from "@/ui/StatusText";
import { PageState, SettingsPage } from "../settings/parts";
import { FeedbackSheet } from "./FeedbackSheet";
import { firstLine } from "./rules";
import type { AdminFeedback, FeedbackPage } from "./types";
import { useAdminRead } from "./useAdminRead";

type Filter = "all" | AdminFeedback["status"];
const FILTERS: Filter[] = ["all", "unread", "read", "archived"];
const PAGE = 50;

const TONE: Record<AdminFeedback["status"], StatusTone> = {
	unread: "attention",
	read: "quiet",
	archived: "muted",
};

/**
 * The feedback inbox: what users sent from the app, newest first, with one
 * chip row (All, Unread, Read, Archived) that carries the counts. A row is the
 * first line, who sent it and when, and its status in a word. Tapping opens it
 * to read, note, archive or delete.
 */
export function FeedbackScreen() {
	const t = useTranslations("mobile.admin.feedback");
	const format = useFormatter();
	const { api } = useSession();
	const { space } = useTheme();
	const [filter, setFilter] = useState<Filter>("all");
	const [openId, setOpenId] = useState<string | null>(null);
	const [more, setMore] = useState(false);
	const { state, reload, patch } = useAdminRead(
		(client) =>
			client.admin.listFeedback({
				limit: PAGE,
				...(filter === "all" ? {} : { status: filter }),
			}),
		filter,
	);

	async function showMore() {
		if (!api || state.status !== "ready" || !state.data.nextCursor || more)
			return;
		setMore(true);
		try {
			const next = await api.admin.listFeedback({
				limit: PAGE,
				cursor: state.data.nextCursor,
				...(filter === "all" ? {} : { status: filter }),
			});
			patch(
				(page): FeedbackPage => ({
					...next,
					items: [...page.items, ...next.items],
				}),
			);
		} catch {
			// The list stays as it is; the button is still there to try again.
		} finally {
			setMore(false);
		}
	}

	if (state.status !== "ready") {
		return <PageState failed={state.status === "error"} />;
	}
	const page = state.data;
	const open = page.items.find((item) => item.id === openId) ?? null;

	return (
		<>
			<SettingsPage>
				<ScrollView
					contentContainerStyle={{
						alignItems: "center",
						gap: space[2],
						paddingHorizontal: space[4],
						paddingBottom: space[3],
					}}
					horizontal
					showsHorizontalScrollIndicator={false}
				>
					{FILTERS.map((id) => (
						<Chip
							key={id}
							label={t("filter", {
								name: t(`status.${id}`),
								count: id === "all" ? page.counts.total : page.counts[id],
							})}
							onPress={() => setFilter(id)}
							selected={filter === id}
						/>
					))}
				</ScrollView>
				{page.items.length === 0 ? (
					<EmptyState title={t(filter === "all" ? "empty" : "emptyFiltered")} />
				) : (
					<ListGroup>
						{page.items.map((item) => (
							<ListRow
								end={
									<StatusText
										label={t(`status.${item.status}`)}
										size="sm"
										tone={TONE[item.status]}
									/>
								}
								key={item.id}
								onPress={() => setOpenId(item.id)}
								sub={t("rowSub", {
									name: item.user.name,
									date: format.dateTime(new Date(item.createdAt), {
										dateStyle: "medium",
									}),
								})}
								title={firstLine(item.message)}
							/>
						))}
					</ListGroup>
				)}
				{page.nextCursor ? (
					<LinkButton label={t("showMore")} onPress={() => void showMore()} />
				) : null}
			</SettingsPage>
			<FeedbackSheet
				item={open}
				key={open?.id ?? "none"}
				onChanged={reload}
				onClose={() => setOpenId(null)}
			/>
		</>
	);
}
