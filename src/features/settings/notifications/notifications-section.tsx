"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Chip } from "~/components/ui/chip";
import { Switch } from "~/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";
import { useAutosave } from "../autosave";
import {
	SectionShell,
	SectionUnavailable,
	SkeletonRowsFor,
} from "../section-shell";
import {
	type Channel,
	DEFAULT_PREF,
	flip,
	NOTIFICATION_TYPES,
	type NotificationType,
	type Pref,
	samePref,
} from "./prefs";

const CHANNELS: Channel[] = ["inApp", "email", "digestMode"];
type Prefs = Partial<Record<NotificationType, Pref>>;

/**
 * Notifications: each event by In app, Email and Digest. A matrix of
 * switches on desktop; on phones each event is a row with three toggles.
 * Each flip saves that event's row with Undo. Digest needs Email.
 */
export function NotificationsSection() {
	const t = useTranslations("settingsV2.notifications");
	const save = useAutosave();
	const phone = useIsMobile();
	const query = api.notification.getPreferences.useQuery();
	const update = api.notification.updatePreferences.useMutation();
	const [prefs, setPrefs] = useState<Prefs>({});

	useEffect(() => {
		if (!query.data) return;
		setPrefs(
			Object.fromEntries(
				query.data.map((p) => [
					p.type,
					{ inApp: p.inApp, email: p.email, digestMode: p.digestMode },
				]),
			),
		);
	}, [query.data]);

	const prefOf = (type: NotificationType) => prefs[type] ?? DEFAULT_PREF;
	const set = (type: NotificationType, channel: Channel, on: boolean) => {
		const prev = prefOf(type);
		void save(
			{
				apply: async (pref: Pref) => {
					setPrefs((p) => ({ ...p, [type]: pref }));
					await update.mutateAsync({ preferences: [{ type, ...pref }] });
				},
				next: flip(prev, channel, on),
				prev,
			},
			samePref,
		);
	};

	return (
		<SectionShell id="notifications" title={t("title")}>
			{query.isLoading ? (
				<SkeletonRowsFor count={5} />
			) : query.isError ? (
				<SectionUnavailable onRetry={() => void query.refetch()} />
			) : phone ? (
				<ul className="flex flex-col rounded-panel border border-line bg-surface px-4 *:border-line *:border-t *:first:border-t-0">
					{NOTIFICATION_TYPES.map((type) => {
						const pref = prefOf(type);
						return (
							<li className="py-3" key={type}>
								<div className="text-body text-fg">{t(`events.${type}`)}</div>
								<div
									className="mt-2 flex flex-wrap gap-2"
									role="group"
									aria-label={t(`events.${type}`)}
								>
									{CHANNELS.map((c) => (
										<Chip
											active={pref[c]}
											aria-pressed={pref[c]}
											disabled={c === "digestMode" && !pref.email}
											key={c}
											onClick={() => set(type, c, !pref[c])}
										>
											{t(`channels.${c}`)}
										</Chip>
									))}
								</div>
							</li>
						);
					})}
				</ul>
			) : (
				<Table>
					<TableHeader className="static border-line !bg-transparent !backdrop-blur-none !shadow-none">
						<TableRow className="border-line hover:bg-transparent">
							<TableHead className="pl-0">
								<span className="sr-only">{t("event")}</span>
							</TableHead>
							{CHANNELS.map((c) => (
								<TableHead className="w-20 text-center" key={c}>
									{t(`channels.${c}`)}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{NOTIFICATION_TYPES.map((type) => {
							const pref = prefOf(type);
							return (
								<TableRow
									className="border-line hover:bg-transparent"
									key={type}
								>
									<TableCell className="pl-0 text-body text-fg">
										{t(`events.${type}`)}
									</TableCell>
									{CHANNELS.map((c) => (
										<TableCell className="text-center" key={c}>
											<Switch
												aria-label={t("switchLabel", {
													channel: t(`channels.${c}`),
													event: t(`events.${type}`),
												})}
												checked={pref[c]}
												disabled={c === "digestMode" && !pref.email}
												onCheckedChange={(on) => set(type, c, on)}
											/>
										</TableCell>
									))}
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
			<p className="mt-2 text-fg-3 text-meta">{t("digestHint")}</p>
		</SectionShell>
	);
}
