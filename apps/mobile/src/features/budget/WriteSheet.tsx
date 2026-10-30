import type { RetrospendClient } from "@retrospend/api-client";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { SheetBody } from "@/features/write/parts";
import { useMoneyWrite } from "@/features/write/useMoneyWrite";
import { type UndoFamily, useUndoToast } from "@/features/write/useUndoToast";
import { noSession, useApi, WriteFrame } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { BudgetChanges } from "./BudgetChanges";
import type { BudgetMonth, BudgetPreview } from "./source";

/** The answer every money write gives: the engine's result and an undo token (null when it cannot be taken back). */
export interface WriteAnswer {
	undo: string | null;
}

export interface WriteProps<I, W extends WriteAnswer> {
	data: BudgetMonth | null;
	submitLabel: string;
	/** The toast sentence once it is written, from the server's answer. */
	message: (out: W) => string;
	/** The exact request body, or null while the form is not complete. */
	input: I | null;
	idempotencyKey: string | null;
	preview: (api: RetrospendClient, body: I) => Promise<BudgetPreview>;
	write: (api: RetrospendClient, body: I, key: string) => Promise<W>;
	/**
	 * Whether the dry run says there is something to save. Save stays off
	 * until the preview is in and this says yes, so a write that changes
	 * nothing (an amount that is already there) is never offered. Default:
	 * any preview that came back.
	 */
	canSave?: (preview: BudgetPreview) => boolean;
	onClose: () => void;
	onDone: () => void;
	children: ReactNode;
	/** Read-only extras under the changes (a stop, a hint), given the dry run once it is in. */
	after?: ReactNode | ((preview: BudgetPreview | null) => ReactNode);
	family?: UndoFamily;
	/** False while the sheet is closed: nothing is asked of the server. */
	active?: boolean;
}

/**
 * The body of one money write: the fields, the server's dry run of the exact
 * body, one Save that stays off until that is in (and says there is
 * something to save), the write with one idempotency key, and an Undo toast.
 * A form only builds the body.
 */
export function WriteForm<I, W extends WriteAnswer>({
	data,
	submitLabel,
	message,
	input,
	idempotencyKey,
	preview,
	write,
	canSave,
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
		announce({ message: message(out), token: out.undo, onChanged: onDone });
		onClose();
	}

	const ready =
		flow.status === "ready" &&
		(canSave === undefined || (flow.preview !== null && canSave(flow.preview)));

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
					{typeof after === "function" ? after(flow.preview) : after}
				</>
			}
			failed={flow.commitFailed}
			onSubmit={submit}
			ready={ready}
			submitLabel={submitLabel}
		>
			{children}
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

/** A sheet of its own around one write form. */
export function WriteSheet<I, W extends WriteAnswer>({
	visible,
	title,
	detent = "large",
	...form
}: WriteProps<I, W> & {
	visible: boolean;
	title: string;
	detent?: SheetDetent;
}) {
	return (
		<FormSheet
			detent={detent}
			onClose={form.onClose}
			title={title}
			visible={visible}
		>
			<WriteForm {...form} active={visible} />
		</FormSheet>
	);
}

/**
 * The way back from a form that opened inside a sheet: a chevron and the
 * word in the brand color, the way a navigation bar draws Back, on its own
 * line at the start.
 */
export function BackButton({
	label,
	onPress,
}: {
	label: string;
	onPress: () => void;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<View style={{ alignItems: "flex-start" }}>
			<Pressable
				accessibilityLabel={label}
				accessibilityRole="button"
				onPress={onPress}
				style={({ pressed }) => ({
					minHeight: size.touchMin.phone,
					flexDirection: "row",
					alignItems: "center",
					paddingRight: space[2],
					borderRadius: radius.ctl,
					backgroundColor: pressed ? color.raised : "transparent",
				})}
			>
				<View style={{ transform: [{ rotate: "180deg" }] }}>
					<Glyph
						color={color.brand}
						name="ChevronRight"
						size={size.icon.phone}
					/>
				</View>
				<Text style={{ color: color.brand }} weight="medium">
					{label}
				</Text>
			</Pressable>
		</View>
	);
}
