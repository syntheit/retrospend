"use client";

import { useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";

type Preference = RouterOutputs["notification"]["getPreferences"][number];
type NotificationType = Preference["type"];

type PrefMap = Record<
	NotificationType,
	{ inApp: boolean; email: boolean; digestMode: boolean }
>;

export function NotificationPreferencesCard() {
	const t = useTranslations("settingsPage");

	const TYPE_LABELS = useMemo<Record<NotificationType, string>>(() => ({
		EXPENSE_SPLIT: t("notifExpenseSplit"),
		VERIFICATION_REQUEST: t("notifVerificationRequest"),
		EXPENSE_EDITED: t("notifExpenseEdited"),
		EXPENSE_DELETED: t("notifExpenseDeleted"),
		SETTLEMENT_RECEIVED: t("notifSettlementReceived"),
		SETTLEMENT_CONFIRMED: t("notifSettlementConfirmed"),
		SETTLEMENT_REJECTED: t("notifSettlementRejected"),
		PERIOD_CLOSED: t("notifPeriodClosed"),
		PARTICIPANT_ADDED: t("notifParticipantAdded"),
		PAYMENT_REMINDER: t("notifPaymentReminder"),
	}), [t]);

	const { data: prefs, isLoading } = api.notification.getPreferences.useQuery();
	const utils = api.useUtils();
	const updatePreferences = api.notification.updatePreferences.useMutation({
		onSuccess: () => {
			void utils.notification.getPreferences.invalidate();
		},
		onError: () => {
			toast.error(t("failedToSaveNotifications"));
		},
	});

	// Debounce timer ref: batch rapid toggle changes
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Pending state ref: accumulated changes before save
	const pendingRef = useRef<PrefMap | null>(null);

	const scheduleUpdate = useCallback(
		(updatedMap: PrefMap) => {
			pendingRef.current = updatedMap;
			if (saveTimer.current) clearTimeout(saveTimer.current);
			saveTimer.current = setTimeout(() => {
				const toSave = pendingRef.current;
				if (!toSave) return;
				const preferences = (
					Object.entries(toSave) as [
						NotificationType,
						{ inApp: boolean; email: boolean; digestMode: boolean },
					][]
				).map(([type, v]) => ({ type, ...v }));
				updatePreferences.mutate({ preferences });
			}, 1000);
		},
		[updatePreferences],
	);

	const handleChange = useCallback(
		(
			type: NotificationType,
			field: "inApp" | "email" | "digestMode",
			value: boolean,
		) => {
			if (!prefs) return;

			const currentMap: PrefMap =
				pendingRef.current ??
				(Object.fromEntries(
					prefs.map((p) => [
						p.type,
						{ inApp: p.inApp, email: p.email, digestMode: p.digestMode },
					]),
				) as PrefMap);

			const updated = { ...currentMap };
			updated[type] = { ...updated[type]!, [field]: value };

			// If email is turned off, also turn off digestMode
			if (field === "email" && !value) {
				updated[type] = { ...updated[type]!, digestMode: false };
			}

			scheduleUpdate(updated);
		},
		[prefs, scheduleUpdate],
	);

	// Derive current values: pending state overrides server state
	const getValues = (type: NotificationType) => {
		if (pendingRef.current?.[type]) return pendingRef.current[type];
		const pref = prefs?.find((p) => p.type === type);
		return {
			inApp: pref?.inApp ?? true,
			email: pref?.email ?? false,
			digestMode: pref?.digestMode ?? false,
		};
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("notifications")}</CardTitle>
				<CardDescription>
					{t("notificationsDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="space-y-3">
						{[1, 2, 3, 4, 5].map((i) => (
							<Skeleton className="h-10 w-full" key={i} />
						))}
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b">
									<th className="pb-2 text-left font-medium text-muted-foreground">
										{t("notifColumnType")}
									</th>
									<th className="w-20 pb-2 text-center font-medium text-muted-foreground">
										{t("notifColumnInApp")}
									</th>
									<th className="w-20 pb-2 text-center font-medium text-muted-foreground">
										{t("notifColumnEmail")}
									</th>
									<th className="w-20 pb-2 text-center font-medium text-muted-foreground">
										{t("notifColumnDigest")}
									</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{(
									Object.entries(TYPE_LABELS) as [NotificationType, string][]
								).map(([type, label]) => {
									const vals = getValues(type);
									return (
										<tr key={type}>
											<td className="py-3 pr-4">{label}</td>
											<td className="py-3 text-center">
												<Switch
													checked={vals.inApp}
													onCheckedChange={(v) =>
														handleChange(type, "inApp", v)
													}
												/>
											</td>
											<td className="py-3 text-center">
												<Switch
													checked={vals.email}
													onCheckedChange={(v) =>
														handleChange(type, "email", v)
													}
												/>
											</td>
											<td className="py-3 text-center">
												<Switch
													checked={vals.digestMode}
													disabled={!vals.email}
													onCheckedChange={(v) =>
														handleChange(type, "digestMode", v)
													}
												/>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
						<p className="mt-3 text-muted-foreground text-xs">
							{t("notifDigestDescription")}
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
