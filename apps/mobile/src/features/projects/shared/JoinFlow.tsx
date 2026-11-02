import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { absoluteImage, useFaces } from "@/features/read/faces";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { FieldError, TextField } from "@/ui/TextField";
import { Cover } from "../Cover";
import {
	createGuestApi,
	type Ghost,
	type InviteInfo,
} from "./guestApi";
import { writeGuestRecord } from "./guestStore";
import type { GuestRecord } from "./sharedAccess";

/** What the invite offers: the cover, the name, how many people and the role. */
function InviteHeader({
	projectId,
	info,
	baseUrl,
}: {
	projectId: string;
	info: InviteInfo;
	baseUrl: string;
}) {
	const t = useTranslations("mobile.projects.shared");
	const roles = useTranslations("mobile.projects.role");
	const { size, space } = useTheme();
	return (
		<View
			style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}
		>
			<Cover
				diameter={size.avatar.lg}
				id={projectId}
				imageUri={absoluteImage(info.projectImagePath, baseUrl)}
				name={info.projectName}
			/>
			<View style={{ flex: 1 }}>
				<Text accessibilityRole="header" numberOfLines={2} variant="title">
					{t("joinTitle", { project: info.projectName })}
				</Text>
				<Text tone="fg2" variant="small">
					{t("joinSub", {
						count: info.participantCount,
						role: roles(info.roleGranted as "VIEWER"),
					})}
				</Text>
			</View>
		</View>
	);
}

/** "Are you one of these people?": pick yourself to keep your history. */
function Chooser({
	projectName,
	ghosts,
	onPick,
	onNew,
}: {
	projectName: string;
	ghosts: Ghost[];
	onPick: (ghost: Ghost) => void;
	onNew: () => void;
}) {
	const t = useTranslations("mobile.projects.shared");
	const faces = useFaces();
	const { space } = useTheme();
	const list = faces(
		ghosts.map((g) => ({ key: g.id, name: g.name, imageUrl: null })),
	);
	return (
		<View style={{ gap: space[4] }}>
			<View style={{ gap: space[1] }}>
				<Text accessibilityRole="header" variant="title">
					{t("chooserTitle")}
				</Text>
				<Text tone="fg2">{t("chooserHint", { project: projectName })}</Text>
			</View>
			<ListGroup>
				{ghosts.map((g, i) => {
					const face = list[i];
					return (
						<ListRow
							chevron
							key={g.id}
							lead={face ? <Avatar face={face} size="row" /> : null}
							onPress={() => onPick(g)}
							title={g.name}
						/>
					);
				})}
			</ListGroup>
			<Button label={t("chooserNone")} onPress={onNew} variant="text" />
		</View>
	);
}

/**
 * The join step for someone holding an invite. Signed in, you join with your
 * own account. Without an account you join as a guest with a name and an
 * email, after the "are you one of these people?" step when the project has
 * people nobody has claimed. Joining as someone already in the project hands
 * their history to the new guest; joining never re-splits past expenses.
 */
export function JoinFlow({
	baseUrl,
	linkId,
	info,
	projectId,
	onGuest,
	onMember,
}: {
	baseUrl: string;
	linkId: string;
	info: InviteInfo;
	projectId: string;
	onGuest: (record: GuestRecord) => void;
	onMember: () => void;
}) {
	const t = useTranslations("mobile.projects.shared");
	const tc = useTranslations("mobile.common");
	const { state, api } = useSession();
	const { space } = useTheme();
	const signedIn = state.status === "signedIn" && api !== null;
	const [ghosts, setGhosts] = useState<Ghost[] | null | undefined>(undefined);
	const [step, setStep] = useState<"choose" | "form">("form");
	const [ghost, setGhost] = useState<Ghost | null>(null);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [resumeSent, setResumeSent] = useState(false);
	// One id per attempt: a retry of the same join replays.
	const [key] = useState(() => newClientId());

	// The people nobody claimed are read once, for the guest form only.
	useEffect(() => {
		if (signedIn) return;
		let live = true;
		createGuestApi(baseUrl)
			.ghosts(linkId)
			.then((list) => {
				if (!live) return;
				setGhosts(list);
				if (list.length > 0) setStep("choose");
			})
			.catch(() => live && setGhosts(null));
		return () => {
			live = false;
		};
	}, [signedIn, baseUrl, linkId]);

	async function joinAccount() {
		if (!api || busy) return;
		setBusy(true);
		setFailed(false);
		try {
			await api.projects.joinWithInvite(
				{ linkId },
				{ context: { idempotencyKey: key } },
			);
			announceEntryChange();
			onMember();
		} catch {
			setFailed(true);
			setBusy(false);
		}
	}

	async function joinGuest() {
		const person = name.trim();
		const address = email.trim();
		if (!person || !address || busy) return;
		setBusy(true);
		setFailed(false);
		try {
			const guest = createGuestApi(baseUrl);
			const out = await guest.register({ linkId, name: person, email: address });
			if (out.resumeEmailSent) {
				setResumeSent(true);
				return;
			}
			const record: GuestRecord = {
				baseUrl,
				projectId: out.projectId,
				projectName: out.projectName,
				token: out.sessionToken,
				sessionId: out.guestSessionId,
				viewerLink: null,
				name: person,
			};
			await writeGuestRecord(record);
			if (ghost?.linkable) {
				await createGuestApi(baseUrl, { token: out.sessionToken })
					.claim({
						linkId,
						guestSessionId: out.guestSessionId,
						shadowId: ghost.id,
					})
					.catch(() => undefined);
			}
			onGuest(record);
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}

	if (resumeSent) {
		return (
			<Screen>
				<EmptyState
					detail={t("resumeHint", { project: info.projectName })}
					title={t("resumeTitle")}
				/>
			</Screen>
		);
	}

	if (!signedIn && ghosts === undefined) return <Screen>{null}</Screen>;

	if (!signedIn && step === "choose" && ghosts && ghosts.length > 0) {
		return (
			<Screen>
				<Chooser
					ghosts={ghosts}
					onNew={() => {
						setGhost(null);
						setName("");
						setStep("form");
					}}
					onPick={(g) => {
						setGhost(g);
						setName(g.name);
						setStep("form");
					}}
					projectName={info.projectName}
				/>
			</Screen>
		);
	}

	return (
		<Screen>
			<View style={{ gap: space[4] }}>
				<InviteHeader baseUrl={baseUrl} info={info} projectId={projectId} />
				{signedIn ? (
					<>
						{failed ? <FieldError>{t("joinFailed")}</FieldError> : null}
						<Button
							busy={busy}
							disabled={busy}
							label={busy ? tc("saving") : t("joinAsYou")}
							onPress={() => void joinAccount()}
						/>
					</>
				) : (
					<>
						{ghosts && ghosts.length > 0 ? (
							<Button
								label={t("back")}
								onPress={() => setStep("choose")}
								variant="text"
							/>
						) : null}
						{ghost && !ghost.linkable ? (
							<Text tone="fg2" variant="small">
								{t("elsewhere", { name: ghost.name })}
							</Text>
						) : null}
						<View style={{ gap: space[3] }}>
							<TextField
								autoCapitalize="words"
								autoComplete="name"
								disabled={busy}
								label={t("name")}
								maxLength={191}
								onChangeText={setName}
								returnKeyType="next"
								textContentType="name"
								value={name}
							/>
							<TextField
								autoComplete="email"
								disabled={busy}
								inputMode="email"
								invalid={failed}
								keyboardType="email-address"
								label={t("email")}
								maxLength={255}
								onChangeText={setEmail}
								onSubmitEditing={() => void joinGuest()}
								returnKeyType="go"
								textContentType="emailAddress"
								value={email}
							/>
							{failed ? <FieldError>{t("joinFailed")}</FieldError> : null}
						</View>
						<Button
							busy={busy}
							disabled={busy || !name.trim() || !email.trim()}
							label={busy ? t("joining") : t("join")}
							onPress={() => void joinGuest()}
						/>
					</>
				)}
			</View>
		</Screen>
	);
}
