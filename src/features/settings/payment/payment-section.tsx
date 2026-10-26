"use client";

import { Link2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useUserSettings } from "~/hooks/use-user-settings";
import {
	getMethodType,
	resolveMethodTypeId,
} from "~/lib/payment-method-registry";
import { api, type RouterOutputs } from "~/trpc/react";
import { useAutosave, useSaveGuard } from "../autosave";
import { SectionShell, SectionUnavailable } from "../section-shell";
import {
	makePrimary,
	moveMethod,
	sameMethods,
	toUpsertInput,
	withVisibility,
} from "./method-list";
import { MethodRow } from "./method-row";
import { MethodSheet } from "./method-sheet";
import { PayLinksMenu } from "./pay-links-menu";
import { type Method, newLocalId, type Visibility } from "./types";

function fromServer(rows: RouterOutputs["paymentMethod"]["list"]): Method[] {
	return rows.map((m) => ({
		id: m.id,
		localId: newLocalId(),
		type: m.type,
		label: m.label ?? "",
		identifier: m.identifier ?? "",
		visibility: m.visibility as Visibility,
		minAmount: m.minAmount ? String(m.minAmount) : "",
		currency: m.currency ?? "",
		network: m.network ?? "",
	}));
}

/**
 * Payment methods: the list people pay you with, first one primary. One
 * menu per method (Edit, Make primary, Visible to, Move up, Move down,
 * Remove); every change saves the list with Undo. Adding and editing use
 * the two-step method sheet.
 */
export function PaymentSection() {
	const t = useTranslations("settingsV2.payment");
	const save = useAutosave();
	const guard = useSaveGuard();
	const utils = api.useUtils();
	const { settings } = useUserSettings();
	const query = api.paymentMethod.list.useQuery();
	const upsert = api.paymentMethod.upsert.useMutation();
	const [methods, setMethods] = useState<Method[]>([]);
	const [editing, setEditing] = useState<Method | null | "new">(null);

	// The ids the server has now: an Undo of Remove brings the method back
	// as a new row, since upsert updates by id and that row is gone.
	const serverIds = useRef(new Set<string>());
	useEffect(() => {
		if (!query.data) return;
		serverIds.current = new Set(query.data.map((m) => m.id));
		setMethods(fromServer(query.data));
	}, [query.data]);

	const write = async (list: Method[]) => {
		const rows = list.map((m) =>
			m.id && !serverIds.current.has(m.id) ? { ...m, id: undefined } : m,
		);
		setMethods(rows);
		await upsert.mutateAsync({ methods: toUpsertInput(rows) });
		await utils.paymentMethod.list.invalidate();
	};
	// The whole list is one field: a change while one is saving is dropped.
	const change = (next: Method[], message?: string) =>
		void guard("methods", () =>
			save(
				{ apply: write, next, prev: methods, message, restore: setMethods },
				sameMethods,
			),
		);

	const nameOf = (m: Method) =>
		m.label ||
		getMethodType(resolveMethodTypeId(m.type, m.currency))?.name ||
		m.type;

	const onModalSave = (m: Method) => {
		const exists = methods.some((x) => x.localId === m.localId);
		change(
			exists
				? methods.map((x) => (x.localId === m.localId ? m : x))
				: [...methods, m],
			exists ? undefined : t("added", { name: nameOf(m) }),
		);
	};

	const add = (
		<Button kind="secondary" onClick={() => setEditing("new")} size="sm">
			<Plus aria-hidden="true" />
			{t("add")}
		</Button>
	);

	return (
		<SectionShell id="payment" title={t("title")}>
			{query.isLoading ? (
				<SkeletonRows count={2} />
			) : query.isError ? (
				<SectionUnavailable onRetry={() => void query.refetch()} />
			) : methods.length === 0 ? (
				<Empty action={add} hint={t("emptyHint")} title={t("empty")} />
			) : (
				<>
					<RowList label={t("title")}>
						{methods.map((m, i) => (
							<MethodRow
								first={i === 0}
								key={m.localId}
								last={i === methods.length - 1}
								method={m}
								name={nameOf(m)}
								onEdit={() => setEditing(m)}
								onMove={(d) => change(moveMethod(methods, i, d))}
								onPrimary={() => change(makePrimary(methods, i))}
								onRemove={() =>
									change(
										methods.filter((x) => x.localId !== m.localId),
										t("removed", { name: nameOf(m) }),
									)
								}
								onVisibility={(v) =>
									change(withVisibility(methods, m.localId, v))
								}
							/>
						))}
					</RowList>
					<div className="mt-3 flex flex-wrap gap-2">
						{add}
						<PayLinksMenu>
							<Link2 aria-hidden="true" />
							{t("copyLink")}
						</PayLinksMenu>
					</div>
				</>
			)}
			<MethodSheet
				editing={editing === "new" ? null : editing}
				onClose={() => setEditing(null)}
				onSave={onModalSave}
				open={editing != null}
				userCurrency={settings?.homeCurrency ?? "USD"}
			/>
		</SectionShell>
	);
}
