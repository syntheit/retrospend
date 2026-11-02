import { dayKey } from "@retrospend/domain/time-zone";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import type { ParticipantType, PersonSummary } from "@/features/people/source";
import { usePeopleOverview } from "@/features/people/usePeople";
import { useFaces } from "@/features/read/faces";
import { Note, SheetBody } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { DateField } from "@/ui/DateField";
import { ListGroup, ListRow } from "@/ui/List";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { FieldError, TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { membersToAdd } from "./addMember";
import type { ProjectMember } from "./source";

const EMAIL = /^\S+@\S+\.\S+$/;

/** More people than this get a find field. */
const FIND_FROM = 8;

type Mode = "known" | "new";

interface Who {
	type: ParticipantType;
	id: string;
	name: string;
}

/**
 * Add person to a project: someone you already share with (a list), or a new
 * person by name and, if you want, an email (the same endpoint as Add person
 * in People; an email that is the account of someone you share with is that
 * account). Either way they join on a day you pick, today by default:
 * expenses before it stay as they are. They join as a Contributor (the API's
 * default). It moves no money, so there is no preview.
 */
export function AddMemberSheet({
	projectId,
	members,
	visible,
	onClose,
	onDone,
}: {
	projectId: string;
	members: ProjectMember[];
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.projects.addPerson");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const faces = useFaces();
	const { space, size } = useTheme();
	const overview = usePeopleOverview();
	const people: PersonSummary[] = useMemo(
		() =>
			overview.state.status === "ready"
				? membersToAdd(overview.state.data.people, members)
				: [],
		[overview.state, members],
	);
	const [mode, setMode] = useState<Mode>("known");
	const [picked, setPicked] = useState<string | null>(null);
	const [find, setFind] = useState("");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [joins, setJoins] = useState(() => dayKey(new Date()));
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	// One id per opening, and the person once made: a retry after the join
	// failed adds the same person, never a second one.
	const personId = useRef(newClientId());
	const made = useRef<Who | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts empty
	useEffect(() => {
		if (!visible) return;
		personId.current = newClientId();
		made.current = null;
		setMode("known");
		setPicked(null);
		setFind("");
		setName("");
		setEmail("");
		setJoins(dayKey(new Date()));
		setFailed(false);
	}, [visible]);

	const trimmed = name.trim();
	const mail = email.trim();
	const mailBad = mail !== "" && !EMAIL.test(mail);
	const ready =
		joins !== "" &&
		!saving &&
		(mode === "known" ? picked !== null : trimmed !== "" && !mailBad);

	async function submit() {
		if (!api || !ready) return;
		setSaving(true);
		setFailed(false);
		try {
			let who: Who;
			if (mode === "known") {
				const person = people.find((p) => p.person.key === picked)?.person;
				if (!person) return;
				who = { type: person.type, id: person.id, name: person.name };
			} else {
				if (!made.current) {
					const created = await api.people.create(
						{
							id: personId.current,
							name: trimmed,
							...(mail ? { email: mail } : {}),
						},
						{ context: { idempotencyKey: personId.current } },
					);
					made.current = {
						type: created.type,
						id: created.id,
						name: created.name,
					};
				}
				who = made.current;
			}
			await api.projects.addMember(
				{
					id: projectId,
					person: { type: who.type, id: who.id },
					joinedOn: joins,
				},
				{ context: { idempotencyKey: newClientId() } },
			);
			announceEntryChange();
			onDone();
			toast.show({
				message: t("added", { name: who.name }),
				undo: {
					label: tc("undo"),
					onUndo: async () => {
						try {
							await api.projects.removeMember(
								{ id: projectId, type: who.type, personId: who.id },
								{ context: { idempotencyKey: newClientId() } },
							);
							announceEntryChange();
							onDone();
							toast.show({ message: t("undone", { name: who.name }) });
						} catch {
							toast.show({ message: t("undoError") });
						}
					},
				},
			});
			onClose();
		} catch {
			setFailed(true);
		} finally {
			setSaving(false);
		}
	}

	const shown = people.filter((p) =>
		p.person.name.toLowerCase().includes(find.trim().toLowerCase()),
	);

	return (
		<Sheet
			detents={["large"]}
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						busy={saving}
						disabled={!ready}
						label={saving ? tc("saving") : t("submit")}
						onPress={() => void submit()}
					/>
				</>
			}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				<Segmented
					accessibilityLabel={t("title")}
					onChange={(next) => {
						setMode(next);
						setFailed(false);
					}}
					options={[
						{ value: "known", label: t("known") },
						{ value: "new", label: t("fresh") },
					]}
					stretch
					value={mode}
				/>
				{mode === "known" ? (
					people.length === 0 ? (
						<Note>{t("empty")}</Note>
					) : (
						<View style={{ gap: space[3] }}>
							{people.length > FIND_FROM ? (
								<TextField
									label={t("find")}
									onChangeText={setFind}
									value={find}
								/>
							) : null}
							{/* A group brings its own side margin; the sheet has its padding already. */}
							<View style={{ marginHorizontal: -size.gutter.phone }}>
								<ListGroup accessibilityLabel={t("known")}>
									{shown.map(({ person }) => {
										const [face] = faces([
											{
												key: person.key,
												name: person.name,
												imageUrl: person.imageUrl,
											},
										]);
										return (
											<ListRow
												key={person.key}
												lead={face ? <Avatar face={face} size="sm" /> : null}
												onPress={() => setPicked(person.key)}
												selected={picked === person.key}
												title={person.name}
											/>
										);
									})}
								</ListGroup>
							</View>
						</View>
					)
				) : (
					<View style={{ gap: space[4] }}>
						<TextField
							autoCapitalize="words"
							label={t("name")}
							maxLength={191}
							onChangeText={setName}
							value={name}
						/>
						<View style={{ gap: space[1] }}>
							<TextField
								invalid={mailBad}
								keyboardType="email-address"
								label={t("email")}
								maxLength={255}
								onChangeText={setEmail}
								placeholder={t("emailPlaceholder")}
								value={email}
							/>
							{mailBad ? <FieldError>{t("emailInvalid")}</FieldError> : null}
						</View>
					</View>
				)}
				<View style={{ gap: space[1] }}>
					<DateField
						label={t("joinsOn")}
						onChange={setJoins}
						quick
						value={joins}
					/>
					<Note>{t("joinsHint")}</Note>
				</View>
				{failed ? <Note tone="attention">{t("error")}</Note> : null}
			</SheetBody>
		</Sheet>
	);
}
