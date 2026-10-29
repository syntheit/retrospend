import Constants from "expo-constants";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { absoluteImage } from "@/features/read/faces";
import { openWebPage } from "@/features/settings/webPages";
import { useTheme } from "@/theme";
import { Avatar, type Face } from "@/ui/Avatar";
import { Glyph, type GlyphName } from "@/ui/Glyph";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TopBar } from "@/ui/TopBar";
import { useSignOut } from "./useSignOut";

const VERSION = Constants.expoConfig?.version ?? null;

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
 * The top bar with the account button. The button opens the account sheet
 * (account.html, phone): you, the places that have no tab, then Sign out and
 * the version. A native sheet: SwiftUI with detents on iOS, an M3 modal
 * bottom sheet on Android.
 */
export function AccountTopBar({ title }: { title: string }) {
	const t = useTranslations("mobile.account");
	const { state } = useSession();
	const baseUrl = useServerBaseUrl();
	const confirmSignOut = useSignOut();
	const { color, space } = useTheme();
	const [open, setOpen] = useState(false);
	const me = state.status === "signedIn" ? state.me : null;
	const face = useMyFace();

	/** Closes the sheet, then goes: a pushed screen or a page on the web. */
	const go = (to: () => unknown) => () => {
		setOpen(false);
		void to();
	};
	const web = (path: string) =>
		go(() => (baseUrl ? openWebPage(baseUrl, path) : undefined));

	return (
		<>
			<TopBar
				account={face ?? undefined}
				accountLabel={t("open")}
				onAccountPress={() => setOpen(true)}
				title={title}
			/>
			<Sheet
				detents={["large"]}
				onClose={() => setOpen(false)}
				title={t("open")}
				visible={open}
			>
				<View style={{ gap: space[6] }}>
					{me && face ? (
						<Pressable
							accessibilityHint={t("profileHint")}
							accessibilityLabel={me.name}
							accessibilityRole="button"
							onPress={go(() => router.push("/settings"))}
							style={({ pressed }) => ({
								flexDirection: "row",
								alignItems: "center",
								gap: space[3],
								paddingVertical: space[2],
								backgroundColor: pressed ? color.raised : undefined,
							})}
						>
							<Avatar face={face} size="md" />
							<View style={{ flex: 1, gap: space[1] }}>
								<Text numberOfLines={1} variant="section">
									{me.name}
								</Text>
								<Text numberOfLines={1} tone="fg2" variant="small">
									{me.username ? `@${me.username}` : me.email}
								</Text>
							</View>
							<Chevron />
						</Pressable>
					) : null}
					<View style={{ gap: space[1] }}>
						<Text accessibilityRole="header" tone="fg2" variant="small">
							{t("goTo")}
						</Text>
						<RowList>
							<AccountRow
								glyph="Coins"
								hint={t("opensWeb")}
								label={t("currencies")}
								onPress={web("/currencies")}
							/>
							<AccountRow
								glyph="FileUp"
								hint={t("opensWeb")}
								label={t("import")}
								onPress={web("/import")}
							/>
							<AccountRow
								glyph="Settings"
								label={t("settings")}
								onPress={go(() => router.push("/settings"))}
							/>
						</RowList>
					</View>
					<RowList>
						<AccountRow
							glyph="BookOpen"
							hint={t("opensWeb")}
							label={t("docs")}
							onPress={web("/docs?from=app")}
						/>
						<AccountRow
							glyph="FileText"
							hint={t("opensWeb")}
							label={t("releaseNotes")}
							onPress={web("/releases?from=app")}
						/>
					</RowList>
					<RowList>
						<AccountRow
							chevron={false}
							glyph="LogOut"
							label={t("signOut")}
							onPress={go(confirmSignOut)}
						/>
					</RowList>
					{VERSION ? (
						<Text style={{ textAlign: "center" }} tone="fg3" variant="small">
							{t("version", { version: VERSION })}
						</Text>
					) : null}
				</View>
			</Sheet>
		</>
	);
}

function Chevron() {
	const { color, size } = useTheme();
	return <Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />;
}

/** Rows of one group, a hairline between each (no box around them). */
function RowList({ children }: { children: ReactNode }) {
	const { color } = useTheme();
	const rows = (Array.isArray(children) ? children : [children]).filter(
		Boolean,
	);
	return (
		<View>
			{rows.map((row, index) => (
				<View
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of rows
					key={index}
					style={{
						borderTopWidth: index === 0 ? 0 : 1,
						borderTopColor: color.line,
					}}
				>
					{row}
				</View>
			))}
		</View>
	);
}

/** A row of the sheet: the glyph on a neutral tile, the label, a chevron when it goes somewhere. */
function AccountRow({
	glyph,
	label,
	hint,
	onPress,
	chevron = true,
}: {
	glyph: GlyphName;
	label: string;
	/** Said after the label: where the row goes when it is not obvious. */
	hint?: string;
	onPress: () => void;
	chevron?: boolean;
}) {
	const { color, radius, size, space } = useTheme();
	const tile = size.avatar.default;
	return (
		<Pressable
			accessibilityHint={hint}
			accessibilityLabel={label}
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: size.row.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				backgroundColor: pressed ? color.raised : undefined,
			})}
		>
			<View
				style={{
					width: tile,
					height: tile,
					borderRadius: radius.ctl,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: color.raised,
				}}
			>
				<Glyph color={color.fg2} name={glyph} size={size.icon.phone} />
			</View>
			<Text style={{ flex: 1 }}>{label}</Text>
			{chevron ? <Chevron /> : null}
		</Pressable>
	);
}
