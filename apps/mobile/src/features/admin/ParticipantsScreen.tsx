import { useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { StatusText } from "@/ui/StatusText";
import { Block, PageState, SettingsPage } from "../settings/parts";
import { type Fact, FactsSheet } from "./FactsSheet";
import { useAdminRead } from "./useAdminRead";

type Open = { kind: "shadow" | "guest"; id: string } | null;

/**
 * People added to projects without an account: shadow profiles (made by a
 * user, claimed when the person signs up) and guest sessions (someone who
 * opened a project link). Tapping one shows its facts and lets you delete it;
 * what it was attached to stays, without the name.
 */
export function ParticipantsScreen() {
	const t = useTranslations("mobile.admin.participants");
	const format = useFormatter();
	const { api } = useSession();
	const [open, setOpen] = useState<Open>(null);
	const { state, reload } = useAdminRead((client) =>
		client.admin.listParticipants(),
	);

	if (state.status !== "ready") {
		return (
			<PageState
				failed={state.status === "error"}
				onRetry={() => void reload()}
			/>
		);
	}
	const { shadowProfiles, guestSessions } = state.data;
	const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
	const key = () => ({ context: { idempotencyKey: newClientId() } });

	const shadow =
		open?.kind === "shadow"
			? shadowProfiles.find((p) => p.id === open.id)
			: undefined;
	const guest =
		open?.kind === "guest"
			? guestSessions.find((g) => g.id === open.id)
			: undefined;

	let title: string | null = null;
	let facts: Fact[] = [];
	let remove:
		| { label: string; confirm: string; done: string; run: () => Promise<void> }
		| undefined;
	if (shadow) {
		title = shadow.name;
		facts = [
			{ label: t("createdBy"), value: shadow.createdByUsername },
			{ label: t("created"), value: day(shadow.createdAt) },
			{
				label: t("status"),
				value: shadow.claimedByUsername
					? t("claimedBy", { name: shadow.claimedByUsername })
					: t("unclaimed"),
			},
			{ label: t("projects"), value: String(shadow.projectCount) },
		];
		remove = {
			label: t("delete"),
			confirm: t("deleteTitle", { name: shadow.name }),
			done: t("deleted"),
			run: async () => {
				await api?.admin.deleteShadowProfile({ id: shadow.id }, key());
				await reload();
			},
		};
	} else if (guest) {
		title = guest.name;
		facts = [
			{ label: t("email"), value: guest.email },
			{ label: t("project"), value: guest.projectName },
			{ label: t("created"), value: day(guest.createdAt) },
			{ label: t("lastActive"), value: day(guest.lastActiveAt) },
		];
		remove = {
			label: t("delete"),
			confirm: t("deleteTitle", { name: guest.name }),
			done: t("deleted"),
			run: async () => {
				await api?.admin.deleteGuestSession({ id: guest.id }, key());
				await reload();
			},
		};
	}

	return (
		<>
			<SettingsPage>
				{shadowProfiles.length === 0 && guestSessions.length === 0 ? (
					<EmptyState title={t("empty")} />
				) : null}
				{shadowProfiles.length > 0 ? (
					<Block title={t("shadow")}>
						<ListGroup>
							{shadowProfiles.map((p) => (
								<ListRow
									end={
										<StatusText
											label={p.claimedByUsername ? t("claimed") : t("unclaimed")}
											size="sm"
											tone={p.claimedByUsername ? "quiet" : "muted"}
										/>
									}
									key={p.id}
									onPress={() => setOpen({ kind: "shadow", id: p.id })}
									title={p.name}
								/>
							))}
						</ListGroup>
					</Block>
				) : null}
				{guestSessions.length > 0 ? (
					<Block title={t("guests")}>
						<ListGroup>
							{guestSessions.map((g) => (
								<ListRow
									key={g.id}
									onPress={() => setOpen({ kind: "guest", id: g.id })}
									sub={g.projectName}
									title={g.name}
								/>
							))}
						</ListGroup>
					</Block>
				) : null}
			</SettingsPage>
			<FactsSheet
				facts={facts}
				onClose={() => setOpen(null)}
				remove={remove}
				title={title}
			/>
		</>
	);
}
