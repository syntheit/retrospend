"use client";

import { useApi } from "@retrospend/api-client/react";
import type { WebhookDto } from "@retrospend/api-contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { ActionHandlers } from "~/components/actions/types";
import type { WebhookTarget } from "~/components/actions/webhook";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { CreateWebhookSheet } from "./create-webhook-sheet";
import { DeliveriesSheet } from "./deliveries-sheet";
import { EditWebhookSheet } from "./edit-webhook-sheet";
import { RotateSecretSheet } from "./rotate-secret-sheet";
import { SecretSheet } from "./secret-sheet";
import { TokenBlock } from "./token-rows";
import { WebhookRow } from "./webhook-rows";

type Named = { id: string; name: string };

/**
 * Webhooks: create (the signing secret shows once), edit (with Undo), turn
 * off and on (with Undo), test delivery, the delivery log, rotate secret and
 * delete. Rotate asks how long the old secret keeps working in its own sheet;
 * delete cannot be undone, so it asks first with a named button.
 */
export function WebhooksBlock() {
	const t = useTranslations("settingsV2.developer");
	const toast = useToast();
	const { utils } = useApi();
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<WebhookDto | null>(null);
	const [rotating, setRotating] = useState<Named | null>(null);
	const [logOf, setLogOf] = useState<Named | null>(null);
	const [rotated, setRotated] = useState<{
		name: string;
		secret: string;
	} | null>(null);
	const hooks = useQuery(
		utils.webhooks.list.queryOptions({ input: { limit: 50 } }),
	);
	const update = useMutation(utils.webhooks.update.mutationOptions());
	const test = useMutation(utils.webhooks.test.mutationOptions());
	const remove = useMutation(utils.webhooks.delete.mutationOptions());

	const byId = useMemo(
		() => new Map(hooks.data?.items.map((w) => [w.id, w])),
		[hooks.data],
	);

	const handlers = useMemo<ActionHandlers<WebhookTarget>>(() => {
		const fail = () => toast.failed(t("failed"));
		const setEnabled = (w: Named, enabled: boolean) =>
			update.mutateAsync({ id: w.id, enabled });
		const turn = (enabled: boolean) => async (w: WebhookTarget) => {
			try {
				await setEnabled(w, enabled);
				toast.saved(t(enabled ? "turnedOn" : "turnedOff", { name: w.name }), {
					undo: () => setEnabled(w, !enabled),
				});
			} catch {
				fail();
			}
		};
		return {
			edit: (w) => setEditing(byId.get(w.id) ?? null),
			test: async (w) => {
				try {
					const d = await test.mutateAsync({ id: w.id });
					if (d.status === "succeeded")
						toast.saved(t("testOk", { name: w.name }));
					else toast.failed(t("testFailed", { reason: d.lastError ?? "" }));
				} catch {
					fail();
				}
			},
			deliveries: (w) => setLogOf({ id: w.id, name: w.name }),
			turnOff: turn(false),
			turnOn: turn(true),
			rotateSecret: (w) => setRotating({ id: w.id, name: w.name }),
			delete: async (w) => {
				try {
					await remove.mutateAsync({ id: w.id });
					toast.saved(t("webhookDeleted", { name: w.name }));
				} catch {
					fail();
				}
			},
		};
	}, [byId, remove, t, test, toast, update]);

	return (
		<>
			<TokenBlock
				action={
					<Button kind="secondary" onClick={() => setCreating(true)} size="sm">
						<Plus aria-hidden="true" />
						{t("newWebhook")}
					</Button>
				}
				empty={{ title: t("noWebhooks"), hint: t("noWebhooksHint") }}
				state={{
					isLoading: hooks.isLoading,
					// A failed refetch keeps the rows it has: a row goes only when the server drops it.
					isError: hooks.isError && !hooks.data,
					count: hooks.data?.items.length ?? 0,
					retry: () => void hooks.refetch(),
				}}
				title={t("webhooks")}
			>
				{hooks.data?.items.map((w) => (
					<WebhookRow handlers={handlers} key={w.id} webhook={w} />
				))}
			</TokenBlock>
			<CreateWebhookSheet onOpenChange={setCreating} open={creating} />
			<EditWebhookSheet
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
				webhook={editing}
			/>
			<RotateSecretSheet
				onOpenChange={(open) => {
					if (!open) setRotating(null);
				}}
				onRotated={setRotated}
				webhook={rotating}
			/>
			<DeliveriesSheet
				onOpenChange={(open) => {
					if (!open) setLogOf(null);
				}}
				open={logOf !== null}
				webhook={logOf}
			/>
			<SecretSheet
				name={rotated?.name ?? ""}
				onClose={() => setRotated(null)}
				secret={rotated?.secret ?? null}
			/>
		</>
	);
}
