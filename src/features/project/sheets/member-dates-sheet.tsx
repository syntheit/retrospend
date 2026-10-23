"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { DatePicker } from "~/components/pickers/date-picker";
import { useRowDates } from "~/components/rows/dates";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import type { Member, PageView } from "../types";
import { PreviewLines } from "./preview-lines";

type Ref = {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
};

/** One date that may be open: "from the start" or "still here" is null. */
function DateChoice({
	label,
	open,
	value,
	today,
	onChange,
}: {
	label: string;
	open: string;
	value: string | null;
	today: string;
	onChange: (v: string | null) => void;
}) {
	const t = useTranslations("projectV2.dates");
	return (
		<div className="flex flex-col gap-2">
			<Label>{label}</Label>
			<Segmented
				label={label}
				onChange={(c) => onChange(c === "open" ? null : (value ?? today))}
				options={[
					{ value: "open", label: open },
					{ value: "day", label: t("onADay") },
				]}
				value={value ? "day" : "open"}
			/>
			{value ? (
				<DatePicker onChange={onChange} today={today} value={value} />
			) : null}
		</div>
	);
}

/**
 * When someone joined and left (RC-11). The dates choose who a new expense
 * includes by default; expenses already saved keep their splits. The sheet
 * shows the server's dry run of the change before Save (R30) and the save
 * ends with Undo, which writes the old dates back.
 */
export function MemberDatesSheet({
	view,
	member,
	onOpenChange,
}: {
	view: PageView;
	member: Member;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("projectV2.dates");
	const tp = useTranslations("projectV2.preview.figures");
	const toast = useToast();
	const { short } = useRowDates();
	const utils = api.useUtils();
	const [joinedOn, setJoined] = useState(member.joinedOn);
	const [leftOn, setLeft] = useState(member.leftOn);
	const ref: Ref = {
		participantType: member.participantType as Ref["participantType"],
		participantId: member.participantId,
	};
	const input = { projectId: view.id, ...ref, joinedOn, leftOn };
	const bad = joinedOn !== null && leftOn !== null && leftOn <= joinedOn;
	const changed = joinedOn !== member.joinedOn || leftOn !== member.leftOn;
	const preview = api.project.membershipDatesPreview.useQuery(input, {
		enabled: changed && !bad,
		gcTime: 0,
	});
	const set = api.project.setMembershipDates.useMutation({
		onSuccess: () => utils.project.invalidate(),
	});
	const label = (id: string) =>
		tp(id.replaceAll(".", "_"), { name: member.isMe ? t("you") : member.name });

	return (
		<Sheet
			onOpenChange={onOpenChange}
			onSubmit={async () => {
				if (bad || !changed) return false;
				await set.mutateAsync(input);
				toast.saved(t("saved", { name: member.name }), {
					undo: () =>
						set.mutateAsync({
							projectId: view.id,
							...ref,
							joinedOn: member.joinedOn,
							leftOn: member.leftOn,
						}),
				});
			}}
			open
			submitDisabled={bad || !changed}
			submitLabel={t("submit")}
			title={t("title", { name: member.name })}
		>
			<div className="flex flex-col gap-4">
				<DateChoice
					label={t("joined")}
					onChange={setJoined}
					open={t("fromStart")}
					today={view.today}
					value={joinedOn}
				/>
				<DateChoice
					label={t("left")}
					onChange={setLeft}
					open={t("stillHere")}
					today={view.today}
					value={leftOn}
				/>
				{bad ? (
					<p className="text-danger text-small" role="alert">
						{t("order")}
					</p>
				) : null}
				<p className="text-fg-2 text-small">
					{leftOn
						? t("leaves", { name: member.name, date: short(leftOn) })
						: joinedOn
							? t("joins", { name: member.name, date: short(joinedOn) })
							: t("always", { name: member.name })}
				</p>
				{changed && !bad ? (
					<PreviewLines
						label={label}
						loading={preview.isPending}
						preview={preview.data}
					/>
				) : null}
			</div>
		</Sheet>
	);
}
