import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { ListRow } from "@/features/read/parts";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { BalanceColumn, useBalanceWords } from "./Balance";
import { useDayRange } from "./dates";
import type { ProjectMember } from "./source";

function MemberRow({
	member,
	today,
}: {
	member: ProjectMember;
	today: string;
}) {
	const t = useTranslations("mobile.projects");
	const words = useBalanceWords();
	const faces = useFaces();
	const range = useDayRange();
	const { color, type } = useTheme();
	const [face] = faces([
		{ key: member.id, name: member.name, imageUrl: member.imageUrl },
	]);
	const left = member.leftOn !== null;
	const since = range(member.joinedOn, null, today);
	const sub = [
		member.isMe ? t("you") : null,
		t(`role.${member.role}`),
		left
			? t("leftOn", { date: range(member.leftOn, null, today) ?? "" })
			: since,
	].filter((part): part is string => Boolean(part));
	return (
		<ListRow
			accessibilityLabel={[
				member.name,
				...sub,
				member.isMe ? null : words(member.withMe),
			]
				.filter(Boolean)
				.join(", ")}
		>
			{face ? <Avatar face={face} size="md" /> : null}
			<View style={{ flex: 1, gap: 2 }}>
				<Text
					numberOfLines={1}
					style={{
						color: color.fg,
						fontSize: type.body.size,
						fontWeight: "500",
					}}
				>
					{member.name}
				</Text>
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{sub.join(" · ")}
				</Text>
			</View>
			{member.isMe ? null : <BalanceColumn lines={member.withMe} />}
		</ListRow>
	);
}

/** Who is in the project: face, name, role and what is open between you, per currency. */
export function ProjectPeopleTab({
	members,
	today,
}: {
	members: ProjectMember[];
	today: string;
}) {
	return (
		<View>
			{members.map((member) => (
				<MemberRow key={member.id} member={member} today={today} />
			))}
		</View>
	);
}
