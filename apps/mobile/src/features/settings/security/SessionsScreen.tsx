import type { SignedInSessionDto } from "@retrospend/api-contract";
import { useCallback, useEffect, useState } from "react";

import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { Block, GroupNote, SettingsPage } from "../parts";
import { orderSessions, type SessionName, sessionName } from "./rules";
import { showAlert } from "@/ui/alert";

type Load =
	| { status: "loading" }
	| { status: "failed" }
	| { status: "ready"; items: SignedInSessionDto[] };

/**
 * Where the account is signed in: this phone first, then the other
 * browsers, phones and devices, most recently used first. Tapping another
 * one asks, then signs it out; its token stops working on its next request.
 * This phone signs out from Settings, which also clears it here.
 */
export function SessionsScreen() {
	const t = useTranslations("mobile.settings.security.sessions");
	const tc = useTranslations("mobile.common");
	const format = useFormatter();
	const { api } = useSession();
	const toast = useToast();
	const [load, setLoad] = useState<Load>({ status: "loading" });

	const read = useCallback(async () => {
		if (!api) return;
		try {
			const { items } = await api.account.sessions();
			setLoad({ status: "ready", items: orderSessions(items) });
		} catch {
			setLoad({ status: "failed" });
		}
	}, [api]);

	useEffect(() => {
		void read();
	}, [read]);

	const nameOf = (s: SignedInSessionDto) => {
		const n: SessionName = sessionName(s);
		const system = "system" in n && n.system ? n.system : null;
		if (n.key === "browser")
			return system
				? t("name.browserOn", { browser: n.browser, system })
				: n.browser;
		if (n.key === "app" || n.key === "web")
			return system ? t(`name.${n.key}On`, { system }) : t(`name.${n.key}`);
		return t(`name.${n.key}`);
	};
	const day = (iso: string) =>
		format.dateTime(new Date(iso), { dateStyle: "medium" });

	async function end(s: SignedInSessionDto, name: string) {
		if (!api) return;
		try {
			await api.account.endSession(
				{ id: s.id },
				{ context: { idempotencyKey: newClientId() } },
			);
			toast.show({ message: t("ended", { name }) });
		} catch {
			toast.show({ message: t("endError") });
		}
		await read();
	}

	function ask(s: SignedInSessionDto) {
		const name = nameOf(s);
		showAlert(
			name,
			t("confirm", { used: day(s.lastUsedAt), since: day(s.createdAt) }),
			[
				{ text: tc("cancel"), style: "cancel" },
				{
					text: t("signOut"),
					style: "destructive",
					onPress: () => end(s, name),
				},
			],
		);
	}

	if (load.status === "loading") {
		return (
			<SettingsPage>
				<SkeletonRows count={2} />
			</SettingsPage>
		);
	}
	if (load.status === "failed") {
		return (
			<SettingsPage>
				<EmptyState
					actionLabel={tc("retry")}
					detail={t("errorDetail")}
					onAction={() => void read()}
					title={t("error")}
				/>
			</SettingsPage>
		);
	}

	const mine = load.items.filter((s) => s.current);
	const others = load.items.filter((s) => !s.current);

	return (
		<SettingsPage>
			<Block title={t("thisPhone")}>
				<ListGroup>
					{mine.map((s) => (
						<ListRow
							end={<Text tone="fg2">{t("now")}</Text>}
							key={s.id}
							title={nameOf(s)}
						/>
					))}
				</ListGroup>
			</Block>
			<Block title={t("others")}>
				<ListGroup>
					{others.map((s) => (
						<ListRow
							end={<Text tone="fg2">{day(s.lastUsedAt)}</Text>}
							key={s.id}
							onPress={() => ask(s)}
							title={nameOf(s)}
						/>
					))}
				</ListGroup>
				<GroupNote>{others.length > 0 ? t("footer") : t("none")}</GroupNote>
			</Block>
		</SettingsPage>
	);
}
