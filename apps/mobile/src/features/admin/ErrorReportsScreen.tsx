import { useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { EmptyState } from "@/ui/EmptyState";
import { LinkButton, ListGroup, ListRow } from "@/ui/List";
import { PageState, SettingsPage } from "../settings/parts";
import { FactsSheet } from "./FactsSheet";
import { firstLine } from "./rules";
import { useAdminRead } from "./useAdminRead";

const PAGE = 50;

/**
 * Crashes people's apps sent, newest first. A row is the first line of the
 * message, who sent it, the screen and when. Tapping shows the device, the
 * build and the stack, and lets you delete the report.
 */
export function ErrorReportsScreen() {
	const t = useTranslations("mobile.admin.errors");
	const format = useFormatter();
	const { api } = useSession();
	const [openId, setOpenId] = useState<string | null>(null);
	const [more, setMore] = useState(false);
	const { state, reload, patch } = useAdminRead((client) =>
		client.admin.listErrorReports({ limit: PAGE }),
	);

	async function showMore() {
		if (!api || state.status !== "ready" || !state.data.nextCursor || more)
			return;
		setMore(true);
		try {
			const next = await api.admin.listErrorReports({
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
								sub={t("rowSub", {
									name: item.user.name,
									date: format.dateTime(new Date(item.occurredAt), {
										dateStyle: "medium",
									}),
								})}
								title={firstLine(item.message)}
							/>
						))}
					</ListGroup>
				)}
				{page.nextCursor ? (
					<LinkButton label={t("showMore")} onPress={() => void showMore()} />
				) : null}
			</SettingsPage>
			<FactsSheet
				body={open?.stack}
				facts={
					open
						? [
								{ label: t("message"), value: open.message },
								{ label: t("from"), value: open.user.name },
								{ label: t("kind"), value: open.kind },
								{ label: t("screen"), value: open.screen },
								{ label: t("version"), value: open.appVersion },
								{ label: t("build"), value: open.build },
								{ label: t("os"), value: open.os },
								{ label: t("device"), value: open.device },
								{ label: t("when"), value: when(open.occurredAt) },
							]
						: []
				}
				key={open?.id ?? "none"}
				onClose={() => setOpenId(null)}
				remove={
					open
						? {
								label: t("delete"),
								confirm: t("deleteTitle"),
								done: t("deleted"),
								run: async () => {
									await api?.admin.deleteErrorReport(
										{ id: open.id },
										{ context: { idempotencyKey: newClientId() } },
									);
									await reload();
								},
							}
						: undefined
				}
				title={open ? t("sheet") : null}
			/>
		</>
	);
}
