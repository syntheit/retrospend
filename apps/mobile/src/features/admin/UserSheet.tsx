import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { ListGroup, ListRow } from "@/ui/List";
import { Picker } from "@/ui/Picker";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { userLabel } from "./rules";
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
}: {
	user: AdminUser | null;
	isMe: boolean;
	onClose: () => void;
	/** Reads the list again after a change. */
	onChanged: () => Promise<void>;
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
				onUndo: () => {
					void run(async () => {
						if (active) await api?.admin.disableUser({ id: person.id }, key());
						else await api?.admin.enableUser({ id: person.id }, key());
					}, t("error"));
				},
			},
		});
	}

	function askDisable() {
		Alert.alert(t("disableTitle", { name }), t("disableBody"), [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: t("disable"),
				style: "destructive",
				onPress: () => void setActive(false),
			},
		]);
	}

	function askDelete() {
		Alert.alert(t("deleteTitle", { name }), t("deleteBody"), [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: t("delete"),
				style: "destructive",
				onPress: () => {
					void (async () => {
						const ok = await run(async () => {
							await api?.admin.deleteUser({ id: person.id }, key());
						}, t("error"));
						if (!ok) return;
						onClose();
						toast.show({ message: t("deleted", { name }) });
					})();
				},
			},
		]);
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
					<ListGroup>
						<ListRow
							onPress={
								busy
									? undefined
									: person.isActive
										? askDisable
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
						<ListRow
							end={
								<Picker
									onChange={chooseAi}
									options={[
										{ value: "default", label: t("aiDefault") },
										{ value: "allowed", label: t("aiAllowed") },
										{ value: "blocked", label: t("aiBlocked") },
									]}
									value={ai ?? aiChoiceOf(person.externalAiAllowed)}
								/>
							}
							title={t("ai")}
						/>
						<ListRow
							onPress={busy ? undefined : askDelete}
							title={
								<Text numberOfLines={1} tone="danger" weight="medium">
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
