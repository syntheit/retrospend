import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useFaces } from "@/features/read/faces";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { LinkButton, ListRow, SectionHeader } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { SwipeRow } from "@/ui/SwipeRow";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";
import {
	type NeedsYouItem,
	type NeedsYouList,
	needsLine,
	needsTarget,
	type Snoozed,
	visibleNeeds,
} from "./needs";
import { SNOOZE_CACHE } from "./source";

/** Phones keep Needs you short: the top three, then Show more. */
const COMPACT_COUNT = 3;

function openItem(item: NeedsYouItem) {
	const target = needsTarget(item);
	if (target) {
		router.navigate({
			pathname: "/people/[type]/[id]",
			params: { type: target.type, id: target.id },
		});
	}
}

function NeedsRow({
	item,
	list,
	onLater,
}: {
	item: NeedsYouItem;
	list: NeedsYouList;
	onLater: (item: NeedsYouItem) => void;
}) {
	const t = useTranslations("mobile.home.needs");
	const faces = useFaces();
	const money = useMoneyText();
	const { color, size, type } = useTheme();
	const line = needsLine(item, list);
	const target = needsTarget(item);
	const people = item.people.flatMap((key) => {
		const person = list.people[key];
		return person ? [person] : [];
	});
	const message = t(line.message as "generic", {
		name: line.name,
		title: line.title,
		count: line.count,
		currencies: line.currencies,
	});

	const menu: MenuItem[] = [
		...(target
			? [{ id: "open", label: t("open"), onPress: () => openItem(item) }]
			: []),
		{ id: "later", label: t("later"), onPress: () => onLater(item) },
	];

	return (
		<SwipeRow
			leading={
				target
					? { label: t("open"), onPress: () => openItem(item), tone: "brand" }
					: undefined
			}
			menu={menu}
			menuTitle={message}
			onPress={target ? () => openItem(item) : undefined}
			trailing={{ label: t("later"), onPress: () => onLater(item) }}
		>
			<ListRow
				accessibilityLabel={
					item.amount ? `${message}, ${money(item.amount)}` : message
				}
			>
				{people.length > 0 ? (
					<AvatarStack faces={faces(people)} size="default" />
				) : (
					<View style={{ width: size.avatar.default }} />
				)}
				<View style={{ flex: 1 }}>
					<Text
						numberOfLines={2}
						style={{
							color: color.fg,
							fontSize: type.body.size,
						}}
					>
						{message}
					</Text>
				</View>
				{item.amount ? <MoneyAmount value={item.amount} /> : null}
			</ListRow>
		</SwipeRow>
	);
}

/**
 * What waits for you, in the server's order. Each row swipes to Open or
 * Later, and both are in the long-press menu too (the screen-reader and
 * hardware-keyboard path). Later hides an item until tomorrow, with Undo.
 */
export function NeedsYou({ list }: { list: NeedsYouList }) {
	const t = useTranslations("mobile.home.needs");
	const tc = useTranslations("mobile.common");
	const toast = useToast();
	const { local } = useSession();
	const { color, space, type } = useTheme();
	const [snoozed, setSnoozed] = useState<Snoozed | null>(null);
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		local?.cache
			.read<Snoozed>(SNOOZE_CACHE.name, SNOOZE_CACHE.schema)
			.then((cached) => setSnoozed(cached?.data ?? null));
	}, [local]);

	const save = useCallback(
		(next: Snoozed) => {
			setSnoozed(next);
			local?.cache.write(SNOOZE_CACHE.name, SNOOZE_CACHE.schema, next);
		},
		[local],
	);

	const { shown, hidden } = visibleNeeds(list.items, snoozed, list.today);
	const rows = expanded ? shown : shown.slice(0, COMPACT_COUNT);

	function later(item: NeedsYouItem) {
		const before = snoozed;
		const ids =
			before && before.day === list.today
				? [...before.ids, item.id]
				: [item.id];
		save({ day: list.today, ids });
		toast.show({
			message: t("laterToast"),
			undo: {
				label: tc("undo"),
				onUndo: () => save(before ?? { day: list.today, ids: [] }),
			},
		});
	}

	return (
		<View>
			<SectionHeader
				detail={shown.length > 0 ? String(shown.length) : undefined}
				title={t("title")}
			/>
			{shown.length === 0 ? (
				<Text
					style={{
						color: color.fg2,
						fontSize: type.body.size,
						paddingHorizontal: space[4],
					}}
				>
					{t("empty")}
				</Text>
			) : null}
			{rows.map((item) => (
				<NeedsRow item={item} key={item.id} list={list} onLater={later} />
			))}
			{shown.length > COMPACT_COUNT ? (
				<LinkButton
					label={
						expanded
							? t("showFewer")
							: t("showMore", { count: shown.length - COMPACT_COUNT })
					}
					onPress={() => setExpanded((e) => !e)}
				/>
			) : null}
			{hidden > 0 ? (
				<LinkButton
					label={t("hidden", { count: hidden })}
					onPress={() => save({ day: list.today, ids: [] })}
				/>
			) : null}
		</View>
	);
}
