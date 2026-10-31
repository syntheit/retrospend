import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { useFaces } from "@/features/read/faces";
import { Note, SheetBody } from "@/features/write/parts";
import { useApi, WriteFrame } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { ListGroup, ListRow } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { useDayRange } from "./dates";
import { canSetDates } from "./memberDates";
import { MemberDatesPane } from "./MemberDatesPane";
import {
	type SettingsForm,
	settingsChange,
	settingsChanged,
	settingsOf,
	showsMembers,
} from "./projectSettings";
import type { ProjectPage } from "./source";

/** One member of the list: face, name and the dates they are in the project. */
function MemberRow({
	member,
	today,
	open,
}: {
	member: ProjectPage["members"][number];
	today: string;
	open: (() => void) | null;
}) {
	const t = useTranslations("mobile.projects.settings");
	const faces = useFaces();
	const range = useDayRange();
	const [face] = faces([
		{ key: member.id, name: member.name, imageUrl: member.imageUrl },
	]);
	const since = member.joinedOn
		? t("since", { date: range(member.joinedOn, null, today) ?? "" })
		: t("fromStart");
	const sub = member.leftOn
		? `${since} · ${t("left", { date: range(member.leftOn, null, today) ?? "" })}`
		: since;
	return (
		<ListRow
			accessibilityLabel={`${member.name}, ${sub}`}
			chevron={open !== null}
			lead={face ? <Avatar face={face} size="row" /> : null}
			onPress={open ?? undefined}
			sub={sub}
			title={member.isMe ? t("you", { name: member.name }) : member.name}
		/>
	);
}

/**
 * Project settings, for Owners and Editors: whether new shares count without
 * a review, whether the project stays out of your own insights, and each
 * member's join and leave dates (a screen inside the same sheet, with Back).
 * Name, note, currency and budget are Edit project's. Saving the switches
 * ends with Undo; the dates are a money action with their own preview.
 */
export function ProjectSettingsSheet({
	page,
	visible,
	onClose,
	onDone,
}: {
	page: ProjectPage;
	visible: boolean;
	onClose: () => void;
	/** Something was saved (or put back): the page behind refreshes. */
	onDone: () => void;
}) {
	const t = useTranslations("mobile.projects.settings");
	const tc = useTranslations("mobile.common");
	const api = useApi();
	const toast = useToast();
	const { space, size } = useTheme();
	const original = settingsOf(page);
	const [form, setForm] = useState<SettingsForm>(original);
	const [editing, setEditing] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	// One id per request body: a retry replays, a changed switch is a new write.
	const keys = useRef({ update: newClientId(), exclusion: newClientId() });

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts from the project as it is
	useEffect(() => {
		if (!visible) return;
		setForm(settingsOf(page));
		setEditing(null);
		setFailed(false);
		keys.current = { update: newClientId(), exclusion: newClientId() };
	}, [visible]);

	const change = (patch: Partial<SettingsForm>) => {
		setFailed(false);
		keys.current = { update: newClientId(), exclusion: newClientId() };
		setForm((previous) => ({ ...previous, ...patch }));
	};

	async function write(
		diff: Partial<SettingsForm>,
		key: typeof keys.current,
	): Promise<boolean> {
		if (!api) return false;
		try {
			if (diff.autoAccept !== undefined) {
				await api.projects.update(
					{ id: page.id, autoAcceptSplits: diff.autoAccept },
					{ context: { idempotencyKey: key.update } },
				);
			}
			if (diff.exclude !== undefined) {
				await api.projects.setAnalyticsExclusion(
					{ id: page.id, exclude: diff.exclude },
					{ context: { idempotencyKey: key.exclusion } },
				);
			}
			return true;
		} catch {
			return false;
		}
	}

	async function submit() {
		const diff = settingsChange(original, form);
		setSaving(true);
		setFailed(false);
		const ok = await write(diff, keys.current);
		setSaving(false);
		if (!ok) {
			setFailed(true);
			return;
		}
		const back = settingsChange(form, original);
		announceEntryChange();
		onDone();
		toast.show({
			message: t("saved"),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const undone = await write(back, {
						update: newClientId(),
						exclusion: newClientId(),
					});
					toast.show({ message: undone ? t("undone") : t("undoError") });
					if (undone) {
						announceEntryChange();
						onDone();
					}
				},
			},
		});
		onClose();
	}

	const member = editing
		? (page.members.find((m) => m.id === editing) ?? null)
		: null;

	return (
		<Sheet
			backLabel={tc("back")}
			detents={["large"]}
			onBack={member ? () => setEditing(null) : undefined}
			onClose={onClose}
			title={member ? t("datesTitle", { name: member.name }) : t("title")}
			visible={visible}
		>
			<SheetBody>
				{member ? (
					<MemberDatesPane
						member={member}
						onBack={() => setEditing(null)}
						onSaved={onDone}
						projectId={page.id}
						today={page.today}
					/>
				) : (
					<WriteFrame
						busy={saving}
						changes={null}
						failed={failed}
						onSubmit={submit}
						ready={settingsChanged(original, form)}
						submitLabel={t("submit")}
					>
						<SwitchRow
							detail={t("autoAcceptHint")}
							label={t("autoAccept")}
							onChange={(autoAccept) => change({ autoAccept })}
							value={form.autoAccept}
						/>
						<SwitchRow
							detail={t("excludeHint")}
							label={t("exclude")}
							onChange={(exclude) => change({ exclude })}
							value={form.exclude}
						/>
						{showsMembers(page) ? (
							<View style={{ gap: space[2] }}>
								<Text accessibilityRole="header" weight="semibold">
									{t("members")}
								</Text>
								{/* A group brings its own side margin; the sheet has its padding already. */}
								<View style={{ marginHorizontal: -size.gutter.phone }}>
									<ListGroup accessibilityLabel={t("members")}>
										{page.members.map((m) => (
											<MemberRow
												key={m.id}
												member={m}
												open={
													canSetDates(page.myRole, m)
														? () => setEditing(m.id)
														: null
												}
												today={page.today}
											/>
										))}
									</ListGroup>
								</View>
								<Note>{t("datesHint")}</Note>
							</View>
						) : null}
					</WriteFrame>
				)}
			</SheetBody>
		</Sheet>
	);
}
