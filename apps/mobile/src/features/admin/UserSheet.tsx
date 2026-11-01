import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { ListGroup, ListRow } from "@/ui/List";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { PickerRow } from "../settings/parts";
import { userLabel } from "./rules";
import { confirmWithDevice, emailMatches, hasDeviceLock } from "./stepUp";
import type { AdminUser } from "./types";
import { detailOf } from "./useAdminRead";

type AiChoice = "default" | "allowed" | "blocked";

const aiChoiceOf = (allowed: boolean | null): AiChoice =>
	allowed === null ? "default" : allowed ? "allowed" : "blocked";

const aiValueOf = (choice: AiChoice): boolean | null =>
	choice === "default" ? null : choice === "allowed";

/**
 * One account, as an admin sees it: the facts the server gives (counts and
 * flags, never an expense title), then what can be done. Disabling and
 * deleting ask first and say what changes; disabling ends in an Undo toast.
 * Your own account shows the facts alone, since the server refuses to disable
 * or delete the account you are signed in with.
 */
export function UserSheet({
	user,
	isMe,
	onClose,
	onChanged,
	readUser,
}: {
	user: AdminUser | null;
	isMe: boolean;
	onClose: () => void;
	/** Reads the list again after a change. */
	onChanged: () => Promise<void>;
	/** Reads one account fresh from the server (null when it is gone). */
	readUser: (id: string) => Promise<AdminUser | null>;
}) {
	const t = useTranslations("mobile.admin.users");
	const tc = useTranslations("mobile.common");
	const format = useFormatter();
	const { api } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const body = useSheetBodySize();
	const [busy, setBusy] = useState(false);
	const [ai, setAi] = useState<AiChoice | null>(null);
	// Phones with no screen lock confirm by typing the account's email.
	const [confirming, setConfirming] = useState<"disable" | "delete" | null>(
		null,
	);
	const [typed, setTyped] = useState("");

	if (!user) {
		return (
			<Sheet detents={["large"]} onClose={onClose} visible={false}>
				{null}
			</Sheet>
		);
	}
	const person = user;
	const name = userLabel(person);
	const key = () => ({ context: { idempotencyKey: newClientId() } });
	const day = (iso: string) =>
		format.dateTime(new Date(iso), { dateStyle: "medium" });

	async function run(work: () => Promise<void>, failed: string) {
		if (!api || busy) return false;
		setBusy(true);
		try {
			await work();
			await onChanged();
			return true;
		} catch (error) {
			toast.show({ message: detailOf(error) ?? failed });
			return false;
		} finally {
			setBusy(false);
		}
	}

	async function setActive(active: boolean) {
		const ok = await run(async () => {
			if (active) await api?.admin.enableUser({ id: person.id }, key());
			else await api?.admin.disableUser({ id: person.id }, key());
		}, t("error"));
		if (!ok) return;
		onClose();
		toast.show({
			message: active ? t("enabled", { name }) : t("disabled", { name }),
			undo: {
				label: tc("undo"),
				onUndo: () => void undoActive(active),
			},
		});
	}

	// Undo puts the account back only if it is still as this action left it;
	// if someone else changed it since, say so and leave it alone.
	async function undoActive(left: boolean) {
		let now: AdminUser | null;
		try {
			now = await readUser(person.id);
		} catch {
			toast.show({ message: t("error") });
			return;
		}
		if (!now || now.isActive !== left) {
			toast.show({ message: t("undoChanged", { name }) });
			return;
		}
		await run(async () => {
			if (left) await api?.admin.disableUser({ id: person.id }, key());
			else await api?.admin.enableUser({ id: person.id }, key());
		}, t("error"));
	}

	async function remove() {
		const ok = await run(async () => {
			await api?.admin.deleteUser({ id: person.id }, key());
		}, t("error"));
		if (!ok) return;
		onClose();
		toast.show({ message: t("deleted", { name }) });
	}

	// Disabling and deleting need the device's say-so first: the screen lock
	// (Face ID, Touch ID, passcode, biometric) when the phone has one, else the
	// account's email typed out.
	async function begin(kind: "disable" | "delete") {
		if (!(await hasDeviceLock())) {
			setTyped("");
			setConfirming(kind);
			return;
		}
		Alert.alert(
			kind === "disable"
				? t("disableTitle", { name })
				: t("deleteTitle", { name }),
			undefined,
			[
				{ text: tc("cancel"), style: "cancel" },
				{
					text: kind === "disable" ? t("disable") : t("delete"),
					style: "destructive",
					onPress: () => {
						void (async () => {
							const passed = await confirmWithDevice(
								t(`stepUp.${kind}`),
								tc("cancel"),
							);
							if (!passed) return;
							if (kind === "disable") await setActive(false);
							else await remove();
						})();
					},
				},
			],
		);
	}

	async function confirmTyped() {
		const kind = confirming;
		if (!kind || !emailMatches(typed, person.email)) return;
		if (kind === "disable") await setActive(false);
		else await remove();
	}

	function toggleVerified() {
		void run(async () => {
			await api?.admin.setEmailVerified(
				{ id: person.id, verified: !person.emailVerified },
				key(),
			);
		}, t("error"));
	}

	function chooseAi(choice: AiChoice) {
		setAi(choice);
		void run(async () => {
			await api?.admin.setAiAccess(
				{ id: person.id, allowed: aiValueOf(choice) },
				key(),
			);
		}, t("error")).then((ok) => {
			if (!ok) setAi(null);
		});
	}

	const fact = (label: string, value: string) => (
		<ListRow
			end={
				<Text numberOfLines={1} style={{ flexShrink: 1 }} tone="fg2">
					{value}
				</Text>
			}
			key={label}
			title={label}
		/>
	);

	if (confirming) {
		return (
			<Sheet
				detents={["large"]}
				footer={
					<Button
						disabled={busy || !emailMatches(typed, person.email)}
						label={confirming === "disable" ? t("disable") : t("delete")}
						onPress={() => void confirmTyped()}
						variant="danger"
					/>
				}
				onClose={onClose}
				title={
					confirming === "disable"
						? t("disableTitle", { name })
						: t("deleteTitle", { name })
				}
				visible
			>
				<View style={{ gap: space[4], paddingBottom: space[4] }}>
					<Text tone="fg2">
						{confirming === "disable" ? t("disableBody") : t("deleteBody")}
					</Text>
					<TextField
						autoCapitalize="none"
						label={t("typeEmail", { email: person.email })}
						onChangeText={setTyped}
						value={typed}
					/>
				</View>
			</Sheet>
		);
	}

	return (
		<Sheet detents={["medium", "large"]} onClose={onClose} title={name} visible>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
				style={{ maxHeight: body.height }}
			>
				<ListGroup>
					{fact(t("email"), person.email)}
					{fact(
						t("emailState"),
						person.emailVerified ? t("verified") : t("notVerified"),
					)}
					{fact(t("role"), person.role === "ADMIN" ? t("admin") : t("user"))}
					{fact(t("joined"), day(person.createdAt))}
					{fact(t("expenses"), String(person.expenseCount))}
					{fact(
						t("lastExpense"),
						person.lastExpenseDate
							? day(`${person.lastExpenseDate}T00:00:00`)
							: t("none"),
					)}
					{fact(t("twoFactor"), person.twoFactorEnabled ? t("on") : t("off"))}
				</ListGroup>
				{isMe ? (
					<Text style={{ paddingHorizontal: space[4] }} tone="fg2">
						{t("you")}
					</Text>
				) : (
					<ListGroup form>
						<ListRow
							onPress={
								busy
									? undefined
									: person.isActive
										? () => void begin("disable")
										: () => void setActive(true)
							}
							title={person.isActive ? t("disable") : t("enable")}
						/>
						<ListRow
							onPress={busy ? undefined : toggleVerified}
							title={
								person.emailVerified ? t("markUnverified") : t("markVerified")
							}
						/>
						<PickerRow
							label={t("ai")}
							onChange={chooseAi}
							options={[
								{ value: "default", label: t("aiDefault") },
								{ value: "allowed", label: t("aiAllowed") },
								{ value: "blocked", label: t("aiBlocked") },
							]}
							value={ai ?? aiChoiceOf(person.externalAiAllowed)}
						/>
						<ListRow
							onPress={busy ? undefined : () => void begin("delete")}
							title={
								<Text numberOfLines={1} tone="danger">
									{t("delete")}
								</Text>
							}
						/>
					</ListGroup>
				)}
				<View style={{ height: space[2] }} />
			</ScrollView>
		</Sheet>
	);
}
