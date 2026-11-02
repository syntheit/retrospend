import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { useMoneyText } from "@/features/read/useMoneyText";
import {
	type FigureDiff,
	figureKey,
	figureLines,
} from "@/features/write/figures";
import { Note } from "@/features/write/parts";
import { WriteForm } from "@/features/write/WriteForm";
import { useApi } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { ChangeList, type ChangeStatus } from "@/ui/ChangeList";
import { DateField } from "@/ui/DateField";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { FieldLabel } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { useDayRange } from "./dates";
import {
	bodyOf,
	datesBody,
	datesMeaning,
	datesOf,
	datesOutOfOrder,
	type MemberDates,
} from "./memberDates";
import type { ProjectMember } from "./source";

type Open = "open" | "day";

/** One date that may be open: "from the start" and "still here" are null. */
function DateChoice({
	label,
	openLabel,
	value,
	today,
	onChange,
}: {
	label: string;
	openLabel: string;
	value: string | null;
	today: string;
	onChange: (value: string | null) => void;
}) {
	const t = useTranslations("mobile.projects.dates");
	const { space } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			<FieldLabel>{label}</FieldLabel>
			<Segmented<Open>
				accessibilityLabel={label}
				onChange={(choice) =>
					onChange(choice === "open" ? null : (value ?? today))
				}
				options={[
					{ value: "open", label: openLabel },
					{ value: "day", label: t("onADay") },
				]}
				stretch
				value={value ? "day" : "open"}
			/>
			{value ? (
				<DateField
					label={label}
					onChange={onChange}
					quick
					today={today}
					value={value}
				/>
			) : null}
		</View>
	);
}

/** The dry run of the dates, worded with the member's name. */
function DatesChanges({
	preview,
	status,
	name,
}: {
	preview: FigureDiff | null;
	status: ChangeStatus;
	name: string;
}) {
	const tf = useTranslations("mobile.projects.dates.figures");
	const ti = useTranslations("mobile.projects.dates.figuresInline");
	const tp = useTranslations("mobile.budget.preview");
	const money = useMoneyText();
	const label = (id: string) => {
		const key = figureKey(id);
		return tf.has(key as "other")
			? {
					name: tf(key as "other", { name }),
					inline: ti(key as "other", { name }),
				}
			: { name: tf("other"), inline: ti("other") };
	};
	const lines = preview ? figureLines(preview) : null;
	const side = (value: { minor: number; currency: string } | null): string =>
		value ? money(value) : tp("notAvailable");
	return (
		<ChangeList
			changes={(lines?.changes ?? []).map((change) => ({
				key: change.key,
				label: label(change.id).name,
				value: tp("beforeAfter", {
					before: side(change.before),
					after: side(change.after),
				}),
			}))}
			status={status}
			stays={(lines?.stays ?? []).map((id) => label(id).inline)}
			unavailable={(lines?.unavailable ?? []).map((id) => label(id).inline)}
		/>
	);
}

/**
 * When someone joined and left. The dates choose who a new expense includes
 * by default; expenses already saved keep their splits. Changing them is a
 * money action: the server's dry run of the exact write shows the group
 * total and the person's balance before Save, Save stays off until it is in,
 * and the toast after it undoes the change by writing the old dates back.
 */
export function MemberDatesPane({
	projectId,
	member,
	today,
	onSaved,
	onBack,
}: {
	projectId: string;
	member: ProjectMember;
	today: string;
	/** The dates were written (or put back): the page behind refreshes. */
	onSaved: () => void;
	onBack: () => void;
}) {
	const t = useTranslations("mobile.projects.dates");
	const tc = useTranslations("mobile.common");
	const api = useApi();
	const toast = useToast();
	const range = useDayRange();
	const { space } = useTheme();
	const [dates, setDates] = useState<MemberDates>(datesOf(member));
	const first = member.name.split(/\s+/)[0] ?? member.name;
	const who = member.isMe ? t("you") : first;

	const body = datesBody(projectId, member, dates);
	const out = datesOutOfOrder(dates);
	// biome-ignore lint/correctness/useExhaustiveDependencies: each member starts from their own dates
	useEffect(() => {
		setDates(datesOf(member));
	}, [member.id]);

	async function put(before: MemberDates) {
		if (!api) return false;
		try {
			await api.projects.setMemberDates(bodyOf(projectId, member, before), {
				context: { idempotencyKey: newClientId() },
			});
			return true;
		} catch {
			return false;
		}
	}

	// Undone by writing the old dates back, which has its own words.
	function done() {
		const before = datesOf(member);
		announceEntryChange();
		onSaved();
		toast.show({
			message: t("saved", { name: member.name }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const ok = await put(before);
					toast.show({ message: ok ? t("undone") : t("undoError") });
					if (ok) {
						announceEntryChange();
						onSaved();
					}
				},
			},
		});
	}

	const meaning = datesMeaning(dates);
	const date = range(dates.leftOn ?? dates.joinedOn, null, today) ?? "";

	return (
		<WriteForm
			changes={({ preview, status }) =>
				body ? (
					<DatesChanges name={who} preview={preview} status={status} />
				) : null
			}
			done={done}
			input={body}
			onClose={onBack}
			onDone={onSaved}
			preview={(client, b) => client.projects.previewSetMemberDates(b)}
			submitLabel={t("submit")}
			write={(client, b, key) =>
				client.projects.setMemberDates(b, {
					context: { idempotencyKey: key },
				})
			}
		>
			<DateChoice
				label={t("joined")}
				onChange={(joinedOn) => setDates({ ...dates, joinedOn })}
				openLabel={t("fromStart")}
				today={today}
				value={dates.joinedOn}
			/>
			<DateChoice
				label={t("left")}
				onChange={(leftOn) => setDates({ ...dates, leftOn })}
				openLabel={t("stillHere")}
				today={today}
				value={dates.leftOn}
			/>
			{out ? <Note tone="attention">{t("order")}</Note> : null}
			<View style={{ gap: space[1] }}>
				<Text tone="fg2">{t(meaning, { name: member.name, date })}</Text>
				<Text tone="fg2" variant="small">
					{t("hint")}
				</Text>
			</View>
		</WriteForm>
	);
}
