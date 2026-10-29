import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { AmountField, Note, useAmountLocale } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import type { FormProps } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { Picker } from "@/ui/Picker";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { type MoveDirection, moveRequest, type Peer } from "./bodies";
import { changesAnything } from "./preview";
import { envelopesOf } from "./source";
import { WriteForm } from "./WriteSheet";

const POOL = "pool";

/**
 * Move money between this envelope and another place: add money into it, or
 * take money out. Money from the pool into an envelope is an assign, every
 * other move is a move (the same split as the web). Previewed, then undone
 * from the toast.
 */
export function MoveForm({
	data,
	envelope,
	month,
	onDone,
	onClose,
}: FormProps) {
	const t = useTranslations("mobile.budget.move");
	const tb = useTranslations("mobile.budget");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const { space } = useTheme();
	const currency = data.book.currency;
	const poolName = tb(`pool.${data.toAssign.poolName}`);
	const [direction, setDirection] = useState<MoveDirection>("in");
	const [pick, setPick] = useState<string>(POOL);
	const [draft, setDraft] = useState("");

	// Money can only come from a place that has some; it can go anywhere.
	const places = useMemo(() => {
		const list = [
			{
				value: POOL,
				name: poolName,
				amount: data.toAssign.amount,
			},
			...envelopesOf(data)
				.filter((e) => e.id !== envelope.id)
				.map((e) => ({ value: e.id, name: e.name, amount: e.left })),
		];
		return direction === "in" ? list.filter((p) => p.amount.minor > 0) : list;
	}, [data, envelope.id, poolName, direction]);
	const place = places.find((p) => p.value === pick) ?? places[0] ?? null;
	const peer: Peer | null = place
		? place.value === POOL
			? { kind: "pool" }
			: { kind: "envelope", id: place.value }
		: null;

	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const bodyKey =
		minor === null || !place
			? null
			: JSON.stringify({ direction, place: place.value, minor, month });
	const { idFor } = useWriteIds(bodyKey);
	const request =
		minor === null || !peer
			? null
			: moveRequest({
					batchId: idFor("batch"),
					itemId: idFor("item"),
					month,
					envelopeId: envelope.id,
					direction,
					peer,
					minor,
					currency,
				});

	const otherLabel = direction === "in" ? t("from") : t("to");

	return (
		<WriteForm
			canSave={changesAnything}
			data={data}
			idempotencyKey={
				request
					? request.send === "assign"
						? request.body.batchId
						: request.body.id
					: null
			}
			input={request}
			message={() => {
				const amount = money({ minor: minor ?? 0, currency });
				const other = place?.name ?? "";
				return direction === "in"
					? t("toastIn", { amount, other, name: envelope.name })
					: t("toastOut", { amount, other, name: envelope.name });
			}}
			onClose={onClose}
			onDone={onDone}
			preview={(api, req) =>
				req.send === "assign"
					? api.budget.previewAssign(req.body)
					: api.budget.previewMove(req.body)
			}
			submitLabel={t("submit")}
			write={(api, req, key) => {
				const options = { context: { idempotencyKey: key } };
				return req.send === "assign"
					? api.budget.assign(req.body, options)
					: api.budget.move(req.body, options);
			}}
		>
			<AmountField
				currency={currency}
				draft={draft}
				entered={entered}
				label={t("amount")}
				onDraftChange={setDraft}
			/>
			<Segmented
				accessibilityLabel={t("direction")}
				onChange={(next) => {
					setDirection(next);
					setPick(POOL);
				}}
				options={[
					{ value: "in", label: t("in") },
					{ value: "out", label: t("out") },
				]}
				value={direction}
			/>
			{place ? (
				<View style={{ gap: space[1] }}>
					<Text tone="fg2" variant="small">
						{otherLabel}
					</Text>
					<Picker
						onChange={setPick}
						options={places.map((p) => ({
							value: p.value,
							label: t("place", { name: p.name, amount: money(p.amount) }),
						}))}
						value={place.value}
					/>
				</View>
			) : (
				<Note>{t("nothingToMove", { pool: poolName })}</Note>
			)}
		</WriteForm>
	);
}
