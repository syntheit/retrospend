"use client";

import { useCallback, useRef } from "react";
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

const TYPE_LABELS: Record<NotificationType, string> = {
	EXPENSE_SPLIT: "New shared expense",
	VERIFICATION_REQUEST: "Verification requests",
	EXPENSE_EDITED: "Expense edited",
	EXPENSE_DELETED: "Expense deleted",
	SETTLEMENT_RECEIVED: "Settlement received",
	SETTLEMENT_CONFIRMED: "Settlement confirmed",
	SETTLEMENT_REJECTED: "Settlement rejected",
	PERIOD_CLOSED: "Billing period closed",
	PARTICIPANT_ADDED: "Added to project",
	PAYMENT_REMINDER: "Payment reminders",
};

type PrefMap = Record<
	NotificationType,
	{ inApp: boolean; email: boolean; digestMode: boolean }
>;

export function NotificationPreferencesCard() {
	const { data: prefs, isLoading } = api.notification.getPreferences.useQuery();
	const utils = api.useUtils();
	const updatePreferences = api.notification.updatePreferences.useMutation({
		onSuccess: () => {
			void utils.notification.getPreferences.invalidate();
		},
		onError: () => {
			toast.error("Failed to save notification preferences");
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
				<CardTitle>Notifications</CardTitle>
				<CardDescription>
					Choose how you want to be notified about activity in Retrospend.
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
										Type
									</th>
									<th className="w-20 pb-2 text-center font-medium text-muted-foreground">
										In-App
									</th>
									<th className="w-20 pb-2 text-center font-medium text-muted-foreground">
										Email
									</th>
									<th className="w-20 pb-2 text-center font-medium text-muted-foreground">
										Digest
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
							<strong>Digest</strong> batches email notifications into a single
							daily summary instead of sending them individually. Only available
							when Email is enabled.
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
