import { useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { EmptyState } from "@/ui/EmptyState";
import { LinkButton, ListGroup, ListRow } from "@/ui/List";
import { PageState, SettingsPage } from "../settings/parts";
import { type Fact, FactsSheet } from "./FactsSheet";
import { eventLabel, metadataFacts } from "./auditRules";
import { useAdminRead } from "./useAdminRead";

const PAGE = 50;

/**
 * The audit log: sign-ins, account changes and other security events, newest
 * first. A row is the event, who it was and when. Tapping shows the address
 * and device the server kept (what its audit detail setting allows) and the
 * event's own details. Read only.
 */
export function AuditLogScreen() {
	const t = useTranslations("mobile.admin.audit");
	const format = useFormatter();
	const { api } = useSession();
	const [openId, setOpenId] = useState<string | null>(null);
	const [more, setMore] = useState(false);
	const { state, reload, patch } = useAdminRead((client) =>
		client.admin.eventLogs({ limit: PAGE }),
	);

	async function showMore() {
		if (!api || state.status !== "ready" || !state.data.nextCursor || more)
			return;
		setMore(true);
		try {
			const next = await api.admin.eventLogs({
				limit: PAGE,
				cursor: state.data.nextCursor,
			});
			patch((page) => ({ ...next, items: [...page.items, ...next.items] }));
		} catch {
			// The list stays as it is; the button is still there to try again.
		} finally {
			setMore(false);
		}
	}

	if (state.status !== "ready") {
		return (
			<PageState
				failed={state.status === "error"}
				onRetry={() => void reload()}
			/>
		);
	}
	const page = state.data;
	const open = page.items.find((item) => item.id === openId) ?? null;
	const when = (iso: string) =>
		format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
	const who = (entry: (typeof page.items)[number]) =>
		entry.user ? (entry.user.username ?? entry.user.email) : t("noUser");

	const facts: Fact[] = open
		? [
				{ label: t("when"), value: when(open.timestamp) },
				{ label: t("user"), value: open.user ? open.user.email : null },
				{ label: t("address"), value: open.ipAddress },
				{ label: t("device"), value: open.userAgent },
				...metadataFacts(open.metadata),
			]
		: [];

	return (
		<>
			<SettingsPage>
				{page.items.length === 0 ? (
					<EmptyState title={t("empty")} />
				) : (
					<ListGroup>
						{page.items.map((item) => (
							<ListRow
								key={item.id}
								onPress={() => setOpenId(item.id)}
								sub={t("rowSub", { name: who(item), date: when(item.timestamp) })}
								title={eventLabel(item.eventType)}
							/>
						))}
					</ListGroup>
				)}
				{page.nextCursor ? (
					<LinkButton label={t("showMore")} onPress={() => void showMore()} />
				) : null}
			</SettingsPage>
			<FactsSheet
				facts={facts}
				key={open?.id ?? "none"}
				onClose={() => setOpenId(null)}
				title={open ? eventLabel(open.eventType) : null}
			/>
		</>
	);
}
