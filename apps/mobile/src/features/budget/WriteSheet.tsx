import type { RetrospendClient } from "@retrospend/api-client";
import type { ReactNode } from "react";
import { Sheet } from "@/ui/Sheet";
import { BudgetChanges } from "./BudgetChanges";
import { SheetBody } from "./parts";
import type { BudgetMonth, BudgetPreview } from "./source";
import { useMoneyWrite } from "./useMoneyWrite";
import { type UndoFamily, useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

/** The answer every money write gives: the engine's result and an undo token (null when it cannot be taken back). */
export interface WriteAnswer {
	undo: string | null;
}

export interface WriteProps<I, W extends WriteAnswer> {
	data: BudgetMonth | null;
	submitLabel: string;
	/** The toast sentence once it is written. */
	message: string;
	/** The exact request body, or null while the form is not complete. */
	input: I | null;
	idempotencyKey: string | null;
	preview: (api: RetrospendClient, body: I) => Promise<BudgetPreview>;
	write: (api: RetrospendClient, body: I, key: string) => Promise<W>;
	onClose: () => void;
	onDone: () => void;
	children: ReactNode;
	/** Read-only extras under the changes (a stop, a hint). */
	after?: ReactNode;
	family?: UndoFamily;
	/** False while the sheet is closed: nothing is asked of the server. */
	active?: boolean;
}

/**
 * The body of one money write: the fields, the server's dry run of the exact
 * body, one Save that stays off until that is in, the write with one
 * idempotency key, and an Undo toast. A form only builds the body.
 */
export function WriteForm<I, W extends WriteAnswer>({
	data,
	submitLabel,
	message,
	input,
	idempotencyKey,
	preview,
	write,
	onClose,
	onDone,
	children,
	after,
	family = "budget",
	active = true,
}: WriteProps<I, W>) {
	const api = useApi();
	const announce = useUndoToast(family);
	const flow = useMoneyWrite({
		input: active ? input : null,
		idempotencyKey,
		preview: (body) => (api ? preview(api, body) : noSession()),
		write: (body, key) => (api ? write(api, body, key) : noSession()),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({ message, token: out.undo, onChanged: onDone });
		onClose();
	}

	return (
		<WriteFrame
			busy={flow.committing}
			changes={
				<>
					<BudgetChanges
						data={data}
						preview={flow.preview}
						status={flow.status}
					/>
					{after}
				</>
			}
			failed={flow.commitFailed}
			onSubmit={submit}
			ready={flow.status === "ready"}
			submitLabel={submitLabel}
		>
			{children}
		</WriteFrame>
	);
}

/** A sheet of its own around one write form. */
export function WriteSheet<I, W extends WriteAnswer>({
	visible,
	title,
	...form
}: WriteProps<I, W> & { visible: boolean; title: string }) {
	return (
		<Sheet
			detents={["large"]}
			onClose={form.onClose}
			title={title}
			visible={visible}
		>
			<SheetBody>
				<WriteForm {...form} active={visible} />
			</SheetBody>
		</Sheet>
	);
}
