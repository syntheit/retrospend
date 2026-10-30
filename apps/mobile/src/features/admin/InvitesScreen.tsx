import { Stack } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { AddButton } from "@/ui/AddButton";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { StatusText } from "@/ui/StatusText";
import { useToast } from "@/ui/Toast";
import { Block, GroupNote, PageState, SettingsPage } from "../settings/parts";
import { InviteSheet } from "./InviteSheet";
import { SwitchItem } from "./SwitchItem";
import type { InviteCodeDto } from "./types";
import { detailOf, useAdminRead } from "./useAdminRead";
import { useServerSettings } from "./useServerSettings";

type Status = "active" | "used";
const STATUSES: Status[] = ["active", "used"];

/** Codes are read 100 at a time, up to a cap no self-hosted server reaches. */
const PAGE = 100;
const MAX_PAGES = 5;

/**
 * Invite codes: whether sign-up needs a code and whether every user may make
 * their own (both save at once), then the codes, Active or Used, newest
 * first. The plus in the bar makes a new code and opens it. Tapping a code
 * opens its sheet to copy, share or delete it.
 */
export function InvitesScreen() {
	const t = useTranslations("mobile.admin.invites");
	const format = useFormatter();
	const { api } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const settings = useServerSettings();
	const [status, setStatus] = useState<Status>("active");
	const [openId, setOpenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	const codes = useAdminRead(async (client) => {
		const items: InviteCodeDto[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < MAX_PAGES; page++) {
			const read = await client.admin.listInviteCodes({
				status,
				limit: PAGE,
				cursor,
			});
			items.push(...read.items);
			if (!read.nextCursor) break;
			cursor = read.nextCursor;
		}
		return items;
	}, status);

	async function create() {
		if (!api || creating) return;
		setCreating(true);
		try {
			const made = await api.admin.createInviteCode(undefined, {
				context: { idempotencyKey: newClientId() },
			});
			setStatus("active");
			await codes.reload();
			setOpenId(made.id);
			toast.show({ message: t("created") });
		} catch (error) {
			toast.show({ message: detailOf(error) ?? t("createError") });
		} finally {
			setCreating(false);
		}
	}

	// The plus is the bar's: the system glass plus on iOS, a text plus on Android.
	const add = (
		<Stack.Screen
			options={{
				headerRight: () =>
					Platform.OS === "ios" ? (
						<AddButton label={t("create")} onPress={() => void create()} />
					) : (
						<Button
							accessibilityLabel={t("create")}
							disabled={creating}
							label="+"
							onPress={() => void create()}
							variant="text"
						/>
					),
			}}
		/>
	);

	if (settings.state.status !== "ready") {
		return (
			<>
				{add}
				<PageState failed={settings.state.status === "error"} />
			</>
		);
	}
	const server = settings.state.data;
	const items = codes.state.status === "ready" ? codes.state.data : null;
	const open = items?.find((code) => code.id === openId) ?? null;
	const day = (iso: string) =>
		format.dateTime(new Date(iso), { dateStyle: "medium" });

	return (
		<>
			{add}
			<SettingsPage>
				<ListGroup>
					<SwitchItem
						detail={t("requireDetail")}
						label={t("require")}
						onChange={(on) => void settings.save({ inviteOnlyEnabled: on })}
						value={server.inviteOnlyEnabled}
					/>
					<SwitchItem
						detail={t("everyoneDetail")}
						label={t("everyone")}
						onChange={(on) =>
							void settings.save({ allowAllUsersToGenerateInvites: on })
						}
						value={server.allowAllUsersToGenerateInvites}
					/>
				</ListGroup>
				<Block title={t("codes")}>
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
						{STATUSES.map((id) => (
							<Chip
								key={id}
								label={t(`status.${id}`)}
								onPress={() => setStatus(id)}
								selected={status === id}
							/>
						))}
					</ScrollView>
					{items === null ? (
						<EmptyState
							detail={
								codes.state.status === "error" ? t("errorDetail") : undefined
							}
							title={codes.state.status === "error" ? t("error") : ""}
						/>
					) : items.length === 0 ? (
						<EmptyState title={t(`empty.${status}`)} />
					) : (
						<ListGroup>
							{items.map((code) => (
								<ListRow
									end={
										<StatusText
											label={t(`status.${code.state}`)}
											size="sm"
											tone={code.state === "active" ? "quiet" : "muted"}
										/>
									}
									key={code.id}
									onPress={() => setOpenId(code.id)}
									sub={
										code.usedBy && code.usedAt
											? t("usedBy", {
													name: code.usedBy.username ?? code.usedBy.name,
													date: day(code.usedAt),
												})
											: t("createdBy", {
													name: code.createdBy.username ?? code.createdBy.name,
													date: day(code.createdAt),
												})
									}
									title={code.code}
								/>
							))}
						</ListGroup>
					)}
					{items && items.length > 0 ? (
						<GroupNote>{t("tapNote")}</GroupNote>
					) : null}
				</Block>
				<View style={{ height: space[2] }} />
			</SettingsPage>
			<InviteSheet
				invite={open}
				key={open?.id ?? "none"}
				onChanged={codes.reload}
				onClose={() => setOpenId(null)}
			/>
		</>
	);
}
