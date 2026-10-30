import { Stack } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Chip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { StatusText, type StatusTone } from "@/ui/StatusText";
import { PageState, SettingsPage } from "../settings/parts";
import {
	filterUsers,
	USER_FILTERS,
	type UserFilter,
	userLabel,
	userStatus,
} from "./rules";
import type { AdminUser } from "./types";
import { UserSheet } from "./UserSheet";
import { useAdminRead } from "./useAdminRead";

/** The accounts are read in pages of this size, up to a cap that no self-hosted server reaches. */
const PAGE = 200;
const MAX_PAGES = 5;

async function readAllUsers(
	list: (input: { limit: number; cursor?: string }) => Promise<{
		items: AdminUser[];
		nextCursor: string | null;
	}>,
): Promise<AdminUser[]> {
	const users: AdminUser[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const read = await list({ limit: PAGE, cursor });
		users.push(...read.items);
		if (!read.nextCursor) break;
		cursor = read.nextCursor;
	}
	return users;
}

const STATUS_TONE: Record<"disabled" | "dormant" | "active", StatusTone> = {
	disabled: "danger",
	dormant: "muted",
	active: "quiet",
};

/**
 * Users: every account on the server, newest first, with a search bar under
 * the title and one chip row (All, Admins, Disabled, Unverified). A row is a
 * face, the name and email, and the account's state in a word. Tapping opens
 * the account's sheet.
 */
export function UsersScreen() {
	const t = useTranslations("mobile.admin.users");
	const ts = useTranslations("mobile.admin.users.status");
	const tf = useTranslations("mobile.admin.users.filter");
	const { space } = useTheme();
	const { state: session } = useSession();
	const myId = session.status === "signedIn" ? (session.me?.id ?? null) : null;
	const { state, reload } = useAdminRead((api) =>
		readAllUsers((input) => api.admin.listUsers(input)),
	);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<UserFilter>("all");
	const [openId, setOpenId] = useState<string | null>(null);

	const users = state.status === "ready" ? state.data : null;
	const shown = useMemo(
		() => (users ? filterUsers(users, filter, query) : []),
		[users, filter, query],
	);
	const open = users?.find((user) => user.id === openId) ?? null;
	const today = new Date().toISOString().slice(0, 10);

	if (!users) return <PageState failed={state.status === "error"} />;

	return (
		<>
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						placeholder: t("search"),
						onChangeText: (event) => setQuery(event.nativeEvent.text),
					},
				}}
			/>
			<SettingsPage>
				<ScrollView
					contentContainerStyle={{
						alignItems: "center",
						gap: space[2],
						paddingHorizontal: space[4],
						paddingBottom: space[3],
					}}
					horizontal
					keyboardShouldPersistTaps="handled"
					showsHorizontalScrollIndicator={false}
				>
					{USER_FILTERS.map((id) => (
						<Chip
							key={id}
							label={tf(id)}
							onPress={() =>
								setFilter(filter === id && id !== "all" ? "all" : id)
							}
							selected={filter === id}
						/>
					))}
				</ScrollView>
				{shown.length === 0 ? (
					<EmptyState title={t("noMatch")} />
				) : (
					<ListGroup>
						{shown.map((user) => {
							const status = userStatus(user, today);
							const label = userLabel(user);
							return (
								<ListRow
									end={
										<StatusText
											label={ts(status)}
											size="sm"
											tone={STATUS_TONE[status]}
										/>
									}
									key={user.id}
									lead={
										<Avatar face={{ key: `user:${user.id}`, name: label }} />
									}
									onPress={() => setOpenId(user.id)}
									sub={
										user.role === "ADMIN"
											? t("adminSub", { email: user.email })
											: user.email
									}
									title={label}
								/>
							);
						})}
					</ListGroup>
				)}
				<View style={{ height: space[2] }} />
			</SettingsPage>
			<UserSheet
				isMe={open !== null && open.id === myId}
				key={open?.id ?? "none"}
				onChanged={reload}
				onClose={() => setOpenId(null)}
				user={open}
			/>
		</>
	);
}
