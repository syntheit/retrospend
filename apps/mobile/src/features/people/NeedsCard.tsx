import { useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Glyph } from "@/ui/Glyph";
import { ListGroup, ListRow } from "@/ui/List";
import type { NeedsItem } from "./source";

/**
 * What waits for you, as one card: the faces of who is waiting, "N need
 * you", a line about the first, and a chevron. People opens the first
 * person; Person and Project open the first item. Shared by People, Person
 * and Project.
 */
export function NeedsCard({
	needs,
	onPress,
	inline = false,
}: {
	needs: NeedsItem[];
	onPress: () => void;
	/**
	 * With exactly one item the card shows that item itself, with its share
	 * and a button that answers it, instead of the "1 needs you" summary.
	 * Person and Project use it; People opens the person instead.
	 */
	inline?: boolean;
}) {
	const t = useTranslations("mobile.people");
	const tn = useTranslations("mobile.home.needs");
	const money = useMoneyText();
	const faces = useFaces();
	const { color, size } = useTheme();
	const first = needs[0];
	if (!first) return null;
	const people = [
		...new Map(needs.map((n) => [n.person.key, n.person])).values(),
	];
	const name = first.person.name.split(/\s+/)[0] ?? "";
	const said =
		first.kind === "confirmPayment"
			? tn("payment_confirm", { name })
			: tn("split_review", { name, title: first.title });
	if (inline && needs.length === 1) {
		const action =
			first.kind === "confirmPayment" ? t("needsConfirm") : t("needsReview");
		const detail =
			first.kind === "confirmPayment"
				? money(first.amount)
				: t("needsShare", { amount: money(first.amount) });
		return (
			<ListGroup>
				<ListRow
					accessibilityLabel={`${said}, ${detail}`}
					end={
						<Button
							label={action}
							onPress={onPress}
							size="small"
							variant="outlined"
						/>
					}
					lead={<AvatarStack faces={faces(people)} ring="surface" />}
					onPress={onPress}
					sub={detail}
					title={said}
				/>
			</ListGroup>
		);
	}
	const more = needs.length - 1;
	const sub = more > 0 ? t("needsMore", { first: said, count: more }) : said;
	const title = t("needsYou", { count: needs.length });
	return (
		<ListGroup>
			<ListRow
				accessibilityLabel={`${title}, ${sub}`}
				end={
					<Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />
				}
				lead={<AvatarStack faces={faces(people)} ring="surface" />}
				onPress={onPress}
				sub={sub}
				title={title}
			/>
		</ListGroup>
	);
}
