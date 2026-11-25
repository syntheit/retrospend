import { useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { phoneEnableCallbacks } from "@/auth/enable";
import { phoneNewKeyCallbacks } from "@/auth/new-key";
import { useSession } from "@/auth/session";
import { getPrimitives } from "@/crypto/native";
import { secureStore } from "@/lib/secure-store";
import { ListRow, NavEnd } from "@/ui/List";
import { Skeleton } from "@/ui/Skeleton";
import { TextAction } from "@/ui/TextAction";
import { EnableSheet } from "./EnableSheet";
import { NewKeySheet } from "./NewKeySheet";
import { useProtectionStatus } from "./useProtectionStatus";

/**
 * The Advanced protection row of Security and its enable sheet, apart because
 * the row sits in a list group and the sheet must not. Both are null until the
 * server says it offers protection (a flag that has not loaded, or is off,
 * shows nothing), so the row fails closed. Then: loading, could not load with
 * Try again, off (Turn on, or the reason it cannot be turned on yet) or keys
 * ready. The row reads again whenever the sheet closes.
 */
export function useProtectionRow() {
	const t = useTranslations("protection");
	const { api, baseUrl, state, signIn, verifyCode } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const { status, reload } = useProtectionStatus(me ? api : null);
	const [open, setOpen] = useState(false);
	const [newKeyOpen, setNewKeyOpen] = useState(false);
	// Read when signing in again is needed: the session value changes on every state change.
	const session = useRef({ signIn, verifyCode });
	session.current = { signIn, verifyCode };
	const meId = me?.id;
	const email = me?.email;
	// One set of callbacks for the sheet's life: it remembers the drafts it made.
	const callbacks = useMemo(
		() =>
			api && baseUrl && meId && email
				? phoneEnableCallbacks(
						{
							api: api.protection,
							baseUrl,
							email,
							userId: meId,
							session: () => session.current,
						},
						{ primitives: getPrimitives, store: secureStore },
					)
				: null,
		[api, baseUrl, meId, email],
	);
	// One set of callbacks for the sheet's life, like the enable sheet's.
	const newKeyCallbacks = useMemo(
		() =>
			api && meId
				? phoneNewKeyCallbacks(
						{ api: api.protection, userId: meId },
						{ primitives: getPrimitives },
					)
				: null,
		[api, meId],
	);
	if (!me || status === "hidden") return { row: null, sheet: null };

	const title = t("row.title");
	const verified = me.emailVerified;
	const row =
		status === "loading" ? (
			<ListRow sub={<Skeleton shape="line" width="33%" />} title={title} />
		) : status === "error" ? (
			<ListRow
				end={
					<TextAction label={t("row.retry")} onPress={() => void reload()} />
				}
				sub={t("row.loadFailed")}
				title={title}
			/>
		) : status === "keyed" ? (
			<ListRow
				end={
					newKeyCallbacks ? (
						<TextAction
							label={t("row.makeNewKey")}
							onPress={() => setNewKeyOpen(true)}
						/>
					) : undefined
				}
				sub={t("row.keysReady")}
				title={title}
			/>
		) : (
			<ListRow
				end={verified ? <NavEnd value={t("row.turnOn")} /> : undefined}
				onPress={
					verified && callbacks
						? () => {
								setOpen(true);
							}
						: undefined
				}
				sub={verified ? t("row.off") : t("row.verifyEmailFirst")}
				title={title}
			/>
		);
	const sheet = (
		<>
			{callbacks ? (
				<EnableSheet
					account={me.email}
					makeKeys={callbacks.makeKeys}
					onClose={() => {
						setOpen(false);
						void reload();
					}}
					save={callbacks.save}
					twoFactor={me.twoFactorEnabled}
					visible={open}
				/>
			) : null}
			{newKeyCallbacks ? (
				<NewKeySheet
					account={me.email}
					makeKey={newKeyCallbacks.makeKey}
					onClose={() => setNewKeyOpen(false)}
					save={newKeyCallbacks.save}
					visible={newKeyOpen}
				/>
			) : null}
		</>
	);
	return { row, sheet };
}
