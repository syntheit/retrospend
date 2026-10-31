import { router } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { adminAccess } from "@/features/admin/rules";
import { useFeedback } from "@/features/feedback/FeedbackProvider";
import { absoluteImage } from "@/features/read/faces";
import { openWebPage } from "@/features/settings/webPages";
import { SheetBody } from "@/features/write/parts";
import { appBuild } from "@/lib/appVersion";
import { useTheme } from "@/theme";
import { Avatar, type Face } from "@/ui/Avatar";
import { Glyph, type GlyphName } from "@/ui/Glyph";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { TopBar } from "@/ui/TopBar";
import type { MenuItem, TopBarAction } from "@/ui/types";
import { currenciesHref } from "./places";
import { useSignOut } from "./useSignOut";

/** The signed-in person as a face: the uploaded picture, else the sign-in provider's. */
export function useMyFace(): Face | null {
	const { state } = useSession();
	const baseUrl = useServerBaseUrl();
	const me = state.status === "signedIn" ? state.me : null;
	if (!me) return null;
	return {
		key: `user:${me.id}`,
		name: me.name,
		imageUri: absoluteImage(me.avatarUrl ?? me.image, baseUrl),
	};
}

/**
 * What the sheet counts, read each time it opens: unread notifications for
 * everyone, unread feedback for an admin. A failed read leaves the row without
 * a count.
 */
function useUnreadCounts(open: boolean, admin: boolean) {
	const { api } = useSession();
	const [counts, setCounts] = useState<{
		notifications: number;
		feedback: number;
	}>({ notifications: 0, feedback: 0 });
	useEffect(() => {
		if (!open || !api) return;
		let alive = true;
		void Promise.all([
			api.notifications.unreadCount().then(
				(r) => r.count,
				() => 0,
			),
			admin
				? api.admin.listFeedback({ limit: 1 }).then(
						(r) => r.counts.unread,
						() => 0,
					)
				: Promise.resolve(0),
		]).then(([notifications, feedback]) => {
			if (alive) setCounts({ notifications, feedback });
		});
		return () => {
			alive = false;
		};
	}, [open, api, admin]);
	return counts;
}

/**
 * The top bar with the account button. The button opens the account sheet
 * (account.html, phone): you, the places that have no tab, the links, then
 * Sign out and the version. A native sheet: SwiftUI with detents on iOS, an
 * M3 modal bottom sheet on Android.
 */
export function AccountTopBar({
	title,
	actions,
	overflow,
	overflowLabel,
}: {
	title: string;
	/** Icon-only page actions (Add person), before the overflow and the account button. */
	actions?: TopBarAction[];
	/** The page's overflow menu (the three dots), before the account button. */
	overflow?: MenuItem[];
	overflowLabel?: string;
}) {
	const t = useTranslations("mobile.account");
	const { state } = useSession();
	const baseUrl = useServerBaseUrl();
	const confirmSignOut = useSignOut();
	const feedback = useFeedback();
	const { space } = useTheme();
	const [open, setOpen] = useState(false);
	const me = state.status === "signedIn" ? state.me : null;
	const face = useMyFace();
	const admin = adminAccess(me) === "ok";
	const unread = useUnreadCounts(open, admin);
	const newWord = (count: number) =>
		count > 0 ? (
			<StatusText label={t("newCount", { count })} size="sm" tone="attention" />
		) : undefined;

	/** Closes the sheet, then goes: a pushed screen or a page on the web. */
	const go = (to: () => unknown) => () => {
		setOpen(false);
		void to();
	};
	const web = (path: string) =>
		go(() => (baseUrl ? openWebPage(baseUrl, path) : undefined));
	const opensWeb = t("opensWeb");

	return (
		<>
			<TopBar
				account={face ?? undefined}
				accountLabel={t("open")}
				actions={actions}
				onAccountPress={() => setOpen(true)}
				overflow={overflow}
				overflowLabel={overflowLabel}
				title={title}
			/>
			<Sheet
				detents={["large"]}
				onClose={() => setOpen(false)}
				title={t("open")}
				visible={open}
			>
				<Scrolls>
					<View style={{ gap: space[6] }}>
						{me && face ? (
							<SheetGroup>
								<ListRow
									accessibilityLabel={`${me.name}, ${t("profileHint")}`}
									end={<Chevron />}
									lead={<Avatar face={face} size="md" />}
									onPress={go(() => router.push("/settings/profile"))}
									sub={me.username ? `@${me.username}` : me.email}
									title={me.name}
								/>
							</SheetGroup>
						) : null}
						<SheetGroup>
							<Place
								end={newWord(unread.notifications)}
								glyph="Bell"
								label={t("notifications")}
								onPress={go(() => router.push("/settings/notifications"))}
							/>
						</SheetGroup>
						<View style={{ gap: space[2] }}>
							<Text accessibilityRole="header" tone="fg3" variant="meta">
								{t("goTo")}
							</Text>
							<SheetGroup>
								<Place
									glyph="Coins"
									label={t("currencies")}
									onPress={go(() => router.push(currenciesHref()))}
								/>
								<Place
									glyph="Settings"
									label={t("settings")}
									onPress={go(() => router.push("/settings"))}
								/>
							</SheetGroup>
						</View>
						{admin || me?.canInvite === true ? (
							<SheetGroup>
								{admin ? (
									<Place
										glyph="Shield"
										label={t("admin")}
										onPress={go(() => router.push("/settings/admin"))}
									/>
								) : null}
								<Place
									glyph="KeyRound"
									label={t("inviteCodes")}
									onPress={go(() =>
										router.push(
											admin ? "/settings/admin-invites" : "/settings/invite-codes",
										),
									)}
								/>
								{admin ? (
									<Place
										end={newWord(unread.feedback)}
										glyph="Mail"
										label={t("feedbackInbox")}
										onPress={go(() => router.push("/settings/admin-feedback"))}
									/>
								) : null}
							</SheetGroup>
						) : null}
						<SheetGroup>
							<Place
								glyph="MessageSquare"
								label={t("feedback")}
								onPress={go(() => feedback.open({ afterSheet: true }))}
							/>
							<Place
								glyph="BookOpen"
								label={t("docs")}
								onPress={web("/docs?from=app")}
								web={opensWeb}
							/>
							<Place
								glyph="FileText"
								label={t("releaseNotes")}
								onPress={web("/releases?from=app")}
								web={opensWeb}
							/>
						</SheetGroup>
						<SheetGroup>
							<Place
								glyph="LogOut"
								label={t("signOut")}
								onPress={go(confirmSignOut)}
								plain
							/>
						</SheetGroup>
						<Text style={{ textAlign: "center" }} tone="fg3" variant="small">
							{t("version", appBuild())}
						</Text>
					</View>
				</Scrolls>
			</Sheet>
		</>
	);
}

/**
 * On iOS the sheet gives its content a fixed height and clips what does not
 * fit, so an admin's longer list needs a scroll to reach Sign out and the
 * version. Android lays the sheet out from its content.
 */
function Scrolls({ children }: { children: ReactNode }) {
	return Platform.OS === "ios" ? (
		<SheetBody>{children}</SheetBody>
	) : (
		<>{children}</>
	);
}

function Chevron() {
	const { color, size } = useTheme();
	return <Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />;
}

/**
 * A list group inside the sheet. The sheet already pads its content, so the
 * group takes back its own page gutter and sits on the sheet's edge.
 */
function SheetGroup({ children }: { children: ReactNode }) {
	const { size } = useTheme();
	return (
		<View style={{ marginHorizontal: -size.gutter.phone }}>
			<ListGroup>{children}</ListGroup>
		</View>
	);
}

/** A place the sheet goes: the glyph on a neutral tile, the label, a chevron unless it is plain. */
function Place({
	glyph,
	label,
	onPress,
	web,
	plain,
	end,
}: {
	glyph: GlyphName;
	/** A count before the chevron ("3 new"). */
	end?: ReactNode;
	label: string;
	onPress: () => void;
	/** Said after the label when the row opens a page on the web. */
	web?: string;
	/** An action, not a place: no chevron (Sign out). */
	plain?: boolean;
}) {
	return (
		<ListRow
			accessibilityLabel={web ? `${label}, ${web}` : label}
			end={
				plain ? undefined : (
					<>
						{end}
						<Chevron />
					</>
				)
			}
			lead={<IconTile name={glyph} />}
			onPress={onPress}
			title={label}
		/>
	);
}
