import { useState } from "react";
import { useTranslations } from "use-intl";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { useWriteForm } from "@/features/write/WriteForm";
import type { FormProps } from "@/features/write/WriteFrame";
import { moveRequest } from "./bodies";
import {
	MoneyMoveFrame,
	PlaceRows,
	useMoveAmount,
	usePlaces,
} from "./MoneyMoveFrame";
import { firstEnds, type MoveEnds, POOL, pickEnd, readEnds } from "./moveEnds";
import { changesAnything } from "./preview";
import { envelopesOf } from "./source";

/**
 * Move money in the transfer's shape: the amount as the big figure, the two
 * ends as one line ("Not planned yet → Groceries") and the panels From, To
 * and Changes under it, over the keypad that folds into one Move money
 * button. The envelope the sheet was opened from is always one end; picking it
 * on the other side turns the move around. Money from the pool into an
 * envelope is an assign, every other move is a move (the same split as the
 * web). Previewed in one line (the full block is on the Changes tab), then
 * undone from the toast.
 */
export function MoveForm({
	data,
	envelope,
	month,
	onDone,
	onClose,
}: FormProps) {
	const t = useTranslations("mobile.budget.move");
	const currency = data.book.currency;
	const { envelopePlaces, money } = usePlaces(data);
	const [ends, setEnds] = useState<MoveEnds>(() =>
		firstEnds(envelope.id, [
			{ id: POOL, minor: data.toAssign.amount.minor },
			...envelopesOf(data).map((e) => ({ id: e.id, minor: e.left.minor })),
		]),
	);
	const amount = useMoveAmount(currency, t("amount"));
	const { minor, pad } = amount;

	const placeOf = (id: string) => envelopePlaces.find((p) => p.id === id);
	const left = new Map<string, number>([
		[POOL, data.toAssign.amount.minor],
		...envelopesOf(data).map((e) => [e.id, e.left.minor] as [string, number]),
	]);
	// Money can only come from a place that has some (this envelope can always
	// be the one that gives); it can go anywhere.
	const fromPlaces = envelopePlaces.filter(
		(p) =>
			p.id === envelope.id || p.id === ends.from || (left.get(p.id) ?? 0) > 0,
	);

	const read = readEnds(ends, envelope.id);
	const { idFor } = useWriteIds(
		minor === null || !read ? null : JSON.stringify({ ends, minor, month }),
	);
	const request =
		minor === null || !read
			? null
			: moveRequest({
					batchId: idFor("batch"),
					itemId: idFor("item"),
					month,
					envelopeId: envelope.id,
					direction: read.direction,
					peer: read.peer,
					minor,
					currency,
				});
	const { flow, ready, submit } = useWriteForm({
		input: request,
		idempotencyKey: request
			? request.send === "assign"
				? request.body.batchId
				: request.body.id
			: null,
		preview: (api, req) =>
			req.send === "assign"
				? api.budget.previewAssign(req.body)
				: api.budget.previewMove(req.body),
		write: (api, req, key) => {
			const options = { context: { idempotencyKey: key } };
			return req.send === "assign"
				? api.budget.assign(req.body, options)
				: api.budget.move(req.body, options);
		},
		canSave: changesAnything,
		message: () => {
			const other = placeOf(read?.direction === "in" ? ends.from : ends.to);
			return t(read?.direction === "in" ? "toastIn" : "toastOut", {
				amount: money({ minor: minor ?? 0, currency }),
				other: other?.name ?? "",
				name: envelope.name,
			});
		},
		onClose,
		onDone,
	});

	const patch = (next: MoveEnds) => {
		setEnds(next);
		pad.fold();
	};
	const side = (
		places: typeof envelopePlaces,
		value: string,
		end: "from" | "to",
	) => (
		<PlaceRows
			label={t(end)}
			onPick={(id) => patch(pickEnd(ends, end, id, envelope.id))}
			places={places}
			value={value}
		/>
	);

	return (
		<MoneyMoveFrame
			add={{ label: t("add"), description: t("submit"), folded: t("submit") }}
			amount={amount}
			data={data}
			flow={flow}
			onSubmit={submit}
			panels={[
				{
					key: "from",
					label: t("from"),
					icon: "ArrowUpFromLine",
					node: side(fromPlaces, ends.from, "from"),
				},
				{
					key: "to",
					label: t("to"),
					icon: "ArrowDownToLine",
					node: side(envelopePlaces, ends.to, "to"),
				},
			]}
			ready={ready}
			summary={[
				{
					key: "ends",
					text: `${placeOf(ends.from)?.name ?? ""} → ${placeOf(ends.to)?.name ?? ""}`,
					active: pad.page <= 1,
					onPress: () => pad.goTo(0),
				},
			]}
		/>
	);
}
