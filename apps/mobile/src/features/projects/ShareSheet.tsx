import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Alert, Platform, Share, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useServerBaseUrl } from "@/auth/server-connection";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { Note, SheetBody } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import {
	accessOf,
	activeLink,
	canManageLinks,
	canSetPublic,
	LINK_ROLES,
	type LinkRole,
	projectPageUrl,
} from "./share";
import type { ProjectPage } from "./source";
import { useMagicLinks } from "./useMagicLinks";

/** The system share sheet with one address: iOS sends it as a link, Android as text. */
async function sendAddress(url: string) {
	await Share.share(Platform.OS === "ios" ? { url } : { message: url });
}

/**
 * Share a project: one invite link per role (Can add expenses, Can view),
 * each to copy, send through the system share sheet, replace or turn off;
 * the public page switch (the Owner's); and a plain list of who can see what.
 * The join page for a guest and the public page are web pages: the phone
 * sends their address and never builds them itself. Nothing here moves
 * money, so there is no preview; the public switch ends with Undo like the
 * web's.
 */
export function ShareSheet({
	page,
	visible,
	onClose,
	onDone,
}: {
	page: Pick<ProjectPage, "id" | "visibility" | "myRole">;
	visible: boolean;
	onClose: () => void;
	/** The project's page changed (public or private): the screen behind refreshes. */
	onDone: () => void;
}) {
	const t = useTranslations("mobile.projects.share");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const baseUrl = useServerBaseUrl();
	const toast = useToast();
	const { space } = useTheme();
	const manage = canManageLinks(page.myRole);
	const flow = useMagicLinks(page.id, visible && manage);
	const [isPublic, setPublic] = useState(page.visibility === "PUBLIC");
	const [switching, setSwitching] = useState(false);
	const pageUrl = baseUrl ? projectPageUrl(baseUrl, page.id) : null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts from the page as it is
	useEffect(() => {
		if (visible) setPublic(page.visibility === "PUBLIC");
	}, [visible]);

	async function copy(text: string) {
		try {
			await Clipboard.setStringAsync(text);
			toast.show({ message: t("copied") });
		} catch {
			toast.show({ message: t("copyFailed") });
		}
	}

	async function send(url: string) {
		try {
			await sendAddress(url);
		} catch {
			toast.show({ message: t("shareFailed") });
		}
	}

	function ask(title: string, confirm: string, run: () => void) {
		Alert.alert(title, undefined, [
			{ text: tc("cancel"), style: "cancel" },
			{ text: confirm, style: "destructive", onPress: run },
		]);
	}

	async function writeVisibility(to: "PUBLIC" | "PRIVATE"): Promise<boolean> {
		if (!api) return false;
		try {
			await api.projects.update(
				{ id: page.id, visibility: to },
				{ context: { idempotencyKey: newClientId() } },
			);
			setPublic(to === "PUBLIC");
			announceEntryChange();
			onDone();
			return true;
		} catch {
			return false;
		}
	}

	async function changePublic(on: boolean) {
		setSwitching(true);
		const ok = await writeVisibility(on ? "PUBLIC" : "PRIVATE");
		setSwitching(false);
		if (!ok) {
			toast.show({ message: t("publicError") });
			return;
		}
		toast.show({
			message: on ? t("nowPublic") : t("nowPrivate"),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const undone = await writeVisibility(on ? "PRIVATE" : "PUBLIC");
					if (!undone) toast.show({ message: t("publicError") });
				},
			},
		});
	}

	const roleLabel = (role: LinkRole) => t(`roles.${role}`);

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				{manage ? (
					<View style={{ gap: space[4] }}>
						<Text accessibilityRole="header" weight="semibold">
							{t("links")}
						</Text>
						{flow.status === "loading" ? <Note>{t("loading")}</Note> : null}
						{flow.status === "error" ? (
							<View style={{ gap: space[2], alignItems: "flex-start" }}>
								<Note tone="attention">{t("loadError")}</Note>
								<Button
									label={tc("retry")}
									onPress={() => void flow.retry()}
									variant="outlined"
								/>
							</View>
						) : null}
						{flow.status === "ready"
							? LINK_ROLES.map((role) => {
									const link = activeLink(flow.links, role);
									const busy = flow.busy === role;
									return (
										<View key={role} style={{ gap: space[2] }}>
											<View>
												<Text weight="medium">{roleLabel(role)}</Text>
												<Text tone="fg2" variant="small">
													{link ? t("on") : t("off")}
												</Text>
											</View>
											{link ? (
												<View
													style={{
														flexDirection: "row",
														flexWrap: "wrap",
														alignItems: "center",
														gap: space[2],
													}}
												>
													<Button
														disabled={busy}
														label={t("copy")}
														onPress={() => void copy(link.url)}
														size="small"
														variant="outlined"
													/>
													<Button
														disabled={busy}
														label={t("share")}
														onPress={() => void send(link.url)}
														size="small"
														variant="outlined"
													/>
													<Button
														disabled={busy}
														label={t("newLink")}
														onPress={() =>
															ask(
																t("newLinkTitle"),
																t("newLinkConfirm"),
																() => void flow.replace(role),
															)
														}
														size="small"
														variant="text"
													/>
													<Button
														disabled={busy}
														label={t("turnOff")}
														onPress={() =>
															ask(
																t("turnOffTitle"),
																t("turnOffConfirm"),
																() => void flow.turnOff(role),
															)
														}
														size="small"
														variant="text"
													/>
												</View>
											) : (
												<View style={{ alignItems: "flex-start" }}>
													<Button
														disabled={busy}
														label={busy ? tc("saving") : t("create")}
														onPress={() => void flow.create(role)}
														variant="outlined"
													/>
												</View>
											)}
										</View>
									);
								})
							: null}
						{flow.failed ? <Note tone="attention">{t("linkError")}</Note> : null}
						<Note>{t("linksHint")}</Note>
					</View>
				) : null}

				<View style={{ gap: space[2] }}>
					<SwitchRow
						detail={t("publicHint")}
						disabled={!canSetPublic(page.myRole) || switching}
						label={t("public")}
						onChange={(on) => void changePublic(on)}
						value={isPublic}
					/>
					{canSetPublic(page.myRole) ? null : (
						<Note>{t("publicOwner")}</Note>
					)}
					{isPublic && pageUrl ? (
						<View
							style={{
								flexDirection: "row",
								flexWrap: "wrap",
								gap: space[2],
							}}
						>
							<Button
								label={t("copyPublic")}
								onPress={() => void copy(pageUrl)}
								size="small"
								variant="outlined"
							/>
							<Button
								label={t("share")}
								onPress={() => void send(pageUrl)}
								size="small"
								variant="outlined"
							/>
						</View>
					) : null}
				</View>

				<View style={{ gap: space[2] }}>
					<Text accessibilityRole="header" weight="semibold">
						{t("accessTitle")}
					</Text>
					{accessOf({ links: flow.links, isPublic }).map((line) => (
						<Text
							key={line.id === "link" ? `link:${line.role}` : line.id}
							tone="fg2"
						>
							{line.id === "members"
								? t("access.members")
								: line.id === "link"
									? t(`access.link.${line.role}`)
									: line.on
										? t("access.publicOn")
										: t("access.publicOff")}
						</Text>
					))}
				</View>
			</SheetBody>
		</Sheet>
	);
}
