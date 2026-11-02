import type { RetrospendClient } from "@retrospend/api-client";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/ui/Button";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import type { FigureDiff } from "./figures";
import { Note, SheetBody } from "./parts";
import {
	type PreviewStatus,
	useMoneyWrite,
	useWriteIds,
} from "./useMoneyWrite";
import { useResetOnOpen } from "./useResetOnOpen";
import { type UndoFamily, useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

/** The answer every money write gives: the engine's result and an undo token (null when it cannot be taken back). */
export interface WriteAnswer {
	undo: string | null;
}

/** What one money write is: the exact body, its dry run, its write and its Undo. */
export interface WriteSpec<I, P extends FigureDiff, W extends WriteAnswer> {
	/** The exact request body, or null while the form is not complete. */
	input: I | null;
	/**
	 * The key of the write. Left out, the form keeps one key per body for as
	 * long as the body is the same and makes a new one for each opening.
	 */
	idempotencyKey?: string | null;
	preview: (api: RetrospendClient, body: I) => Promise<P>;
	write: (api: RetrospendClient, body: I, key: string) => Promise<W>;
	/**
	 * Whether the dry run says there is something to save. Save stays off
	 * until the preview is in and this says yes, so a write that changes
	 * nothing (an amount that is already there) is never offered. Default:
	 * any preview that came back.
	 */
	canSave?: (preview: P) => boolean;
	/** The toast sentence once it is written, from the server's answer. */
	message: (out: W) => string;
	family?: UndoFamily;
	onClose: () => void;
	onDone: () => void;
	/** False while the sheet is closed: nothing is asked of the server. */
	active?: boolean;
}

/**
 * The state of one money write (R30, R15): the server's dry run of the exact
 * body, Save off until it is in (and says there is something to save), the
 * write under one idempotency key, and an Undo toast. A form only builds the
 * body; `WriteForm`, `WriteSheet` and the keypad sheets all run on this.
 */
export function useWriteForm<I, P extends FigureDiff, W extends WriteAnswer>({
	input,
	idempotencyKey,
	preview,
	write,
	canSave,
	message,
	family = "budget",
	onClose,
	onDone,
	active = true,
}: WriteSpec<I, P, W>) {
	const api = useApi();
	const announce = useUndoToast(family);
	const { idFor, reset } = useWriteIds(input ? JSON.stringify(input) : null);
	useResetOnOpen(active, reset);
	const flow = useMoneyWrite({
		input: active ? input : null,
		idempotencyKey:
			idempotencyKey !== undefined
				? idempotencyKey
				: input
					? idFor("write")
					: null,
		preview: (body) => (api ? preview(api, body) : noSession()),
		write: (body, key) => (api ? write(api, body, key) : noSession()),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({ message: message(out), token: out.undo, onChanged: onDone });
		onClose();
	}

	const ready =
		flow.status === "ready" &&
		(canSave === undefined || (flow.preview !== null && canSave(flow.preview)));
	return { flow, ready, submit };
}

/** What a form shows of the dry run. */
export interface WriteView<P> {
	preview: P | null;
	status: PreviewStatus;
}

export interface WriteFormProps<I, P extends FigureDiff, W extends WriteAnswer>
	extends WriteSpec<I, P, W> {
	submitLabel: string;
	/** The dry run as the form shows it (the rows that move, what stays). */
	changes: (view: WriteView<P>) => ReactNode;
	/** Read-only extras under the changes (a stop, a hint), given the dry run once it is in. */
	after?: ReactNode | ((preview: P | null) => ReactNode);
	/** The sentence for a write that failed; the generic one by default. */
	error?: string;
	/** The fields; a function is given whether the write is going out (to hold other actions). */
	children?: ReactNode | ((state: { committing: boolean }) => ReactNode);
}

/**
 * The body of one money write: the fields, the dry run, one Save that stays
 * off until that is in, and the write. A form only builds the body.
 */
export function WriteForm<I, P extends FigureDiff, W extends WriteAnswer>({
	submitLabel,
	changes,
	after,
	error,
	children,
	...spec
}: WriteFormProps<I, P, W>) {
	const { flow, ready, submit } = useWriteForm(spec);
	return (
		<WriteFrame
			busy={flow.committing}
			changes={
				<>
					{changes(flow)}
					{typeof after === "function" ? after(flow.preview) : after}
				</>
			}
			error={error}
			failed={flow.commitFailed}
			onSubmit={submit}
			ready={ready}
			submitLabel={submitLabel}
		>
			{typeof children === "function" ? children(flow) : children}
		</WriteFrame>
	);
}

/**
 * A platform sheet around a scrolling body. The detent is the sheet's kind
 * (see sheetRegistry): medium for a short task, large for a long form.
 */
export function FormSheet({
	visible,
	title,
	detent,
	onClose,
	children,
}: {
	visible: boolean;
	title: string | undefined;
	detent: SheetDetent;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<Sheet detents={[detent]} onClose={onClose} title={title} visible={visible}>
			<SheetBody>{children}</SheetBody>
		</Sheet>
	);
}

/** A destructive write: Cancel, then the danger verb, in the sheet's footer. */
export interface Destructive {
	label: string;
	busyLabel: string;
}

export type WriteSheetProps<
	I,
	P extends FigureDiff,
	W extends WriteAnswer,
> = Omit<WriteFormProps<I, P, W>, "submitLabel"> & {
	visible: boolean;
	title: string;
	detent?: SheetDetent;
} & (
		| { submitLabel: string; destructive?: undefined }
		| { destructive: Destructive; submitLabel?: undefined }
	);

/**
 * A sheet of its own around one write. A destructive write (a delete) puts
 * Cancel and the danger verb in the footer, apart; any other has the one
 * primary action pinned in it.
 */
export function WriteSheet<I, P extends FigureDiff, W extends WriteAnswer>({
	visible,
	title,
	detent = "large",
	destructive,
	...form
}: WriteSheetProps<I, P, W>) {
	if (destructive) {
		return (
			<DestructiveSheet
				destructive={destructive}
				detent={detent}
				title={title}
				visible={visible}
				{...form}
			/>
		);
	}
	return (
		<FormSheet
			detent={detent}
			onClose={form.onClose}
			title={title}
			visible={visible}
		>
			<WriteForm {...(form as WriteFormProps<I, P, W>)} active={visible} />
		</FormSheet>
	);
}

function DestructiveSheet<I, P extends FigureDiff, W extends WriteAnswer>({
	visible,
	title,
	detent,
	destructive,
	changes,
	after,
	error,
	children,
	...spec
}: Omit<WriteFormProps<I, P, W>, "submitLabel"> & {
	visible: boolean;
	title: string;
	detent: SheetDetent;
	destructive: Destructive;
}) {
	const tc = useTranslations("mobile.common");
	const t = useTranslations("mobile.budget.write");
	const { flow, ready, submit } = useWriteForm({ ...spec, active: visible });
	return (
		<Sheet
			detents={[detent]}
			footer={
				<>
					<Button label={tc("cancel")} onPress={spec.onClose} variant="text" />
					<Button
						busy={flow.committing}
						disabled={!ready || flow.committing}
						label={flow.committing ? destructive.busyLabel : destructive.label}
						onPress={() => void submit()}
						variant="danger"
					/>
				</>
			}
			footerApart
			onClose={spec.onClose}
			title={title}
			visible={visible}
		>
			<SheetBody>
				{typeof children === "function" ? children(flow) : children}
				{changes(flow)}
				{typeof after === "function" ? after(flow.preview) : after}
				{flow.commitFailed ? (
					<Note tone="attention">{error ?? t("error")}</Note>
				) : null}
			</SheetBody>
		</Sheet>
	);
}
