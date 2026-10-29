import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { currenciesHref, recurringHref } from "@/features/account/places";
import { useAddEntry } from "@/features/entry/AddEntryProvider";
import { useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { openWebPage } from "@/features/settings/webPages";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { IconTile } from "@/ui/IconTile";
import { LinkButton, ListGroup, ListRow, SectionHeader } from "@/ui/List";
import { SwipeRow } from "@/ui/SwipeRow";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";
import {
	type NeedsDestination,
	type NeedsYouItem,
	type NeedsYouList,
	needsAction,
	needsContext,
	needsDestination,
	needsGlyph,
	needsLine,
	type Snoozed,
	visibleNeeds,
} from "./needs";
import { SNOOZE_CACHE } from "./source";

/** Phones keep Needs you short: the top three, then Show more. */
const COMPACT_COUNT = 3;

/** Opens the job of an item: its person, or the screen that holds the action. */
function useOpenNeeds() {
	const baseUrl = useServerBaseUrl();
	const add = useAddEntry();
	return useCallback(
		(to: NeedsDestination) => {
			switch (to.kind) {
				case "person":
					router.navigate({
						pathname: "/people/[type]/[id]",
						params: { type: to.ref.type, id: to.ref.id },
					});
					return;
				case "people":
					router.navigate({
						pathname: "/people",
						params: { segment: "people" },
					});
					return;
				case "recurring":
					router.push(recurringHref());
					return;
				case "activity":
					router.navigate("/activity");
					return;
				case "budget":
					router.navigate("/budget");
					return;
				case "currencies":
					router.push(currenciesHref());
					return;
				case "settings":
					router.push("/settings");
					return;
				case "import":
					if (baseUrl) void openWebPage(baseUrl, "/import");
					return;
				case "add":
					add.open("expense");
					return;
			}
		},
		[add, baseUrl],
	);
}

function NeedsRow({
	item,
	list,
	onLater,
	onOpen,
}: {
	item: NeedsYouItem;
	list: NeedsYouList;
	onLater: (item: NeedsYouItem) => void;
	onOpen: (to: NeedsDestination) => void;
}) {
	const t = useTranslations("mobile.home.needs");
	const faces = useFaces();
	const money = useMoneyText();
	const format = useFormatter();
	const line = needsLine(item, list);
	const to = needsDestination(item);
	const open = () => onOpen(to);
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
	const action = needsAction(item);
	const actionLabel = action === "open" ? t("open") : t(`action.${action}`);
	const context = needsContext(item);
	const [year, month, day] = (context?.day ?? "").split("-").map(Number);
	const sub = [
		item.amount ? money(item.amount) : null,
		context && year && month && day
			? t(`context.${context.key}`, {
					date: format.dateTime(new Date(year, month - 1, day), {
						month: "short",
						day: "numeric",
					}),
				})
			: null,
	]
		.filter(Boolean)
		.join(" · ");

	const menu: MenuItem[] = [
		{ id: "open", label: actionLabel, onPress: open },
		{ id: "later", label: t("later"), onPress: () => onLater(item) },
	];

	return (
		<SwipeRow
			leading={{ label: t("open"), onPress: open, tone: "brand" }}
			menu={menu}
			menuTitle={message}
			onPress={open}
			trailing={{ label: t("later"), onPress: () => onLater(item) }}
		>
			<ListRow
				accessibilityLabel={sub ? `${message}, ${sub}` : message}
				end={
					<Button
						accessibilityLabel={`${actionLabel}, ${message}`}
						label={actionLabel}
						onPress={open}
						size="small"
						variant="outlined"
					/>
				}
				lead={
					people.length > 0 ? (
						<AvatarStack faces={faces(people)} ring="surface" size="default" />
					) : (
						<IconTile
							name={needsGlyph(item)}
							tone={item.type === "recurring.overdue" ? "attention" : "neutral"}
						/>
					)
				}
				sub={sub || undefined}
				title={
					<Text numberOfLines={2} weight="medium">
						{message}
					</Text>
				}
			/>
		</SwipeRow>
	);
}

/**
 * What waits for you, in the server's order, as one inset group. Each row
 * leads with the person's face or a tile for its kind, says it in a sentence
 * (two lines at most) with one fact under it, and ends in its one action. A
 * tap opens the job; a swipe offers Open or Later, and both are in the
 * long-press menu too (the screen-reader and hardware-keyboard path). Later
 * hides an item until tomorrow, with Undo.
 */
export function NeedsYou({ list }: { list: NeedsYouList }) {
	const t = useTranslations("mobile.home.needs");
	const tc = useTranslations("mobile.common");
	const toast = useToast();
	const { local } = useSession();
	const { space } = useTheme();
	const open = useOpenNeeds();
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
				<Text style={{ paddingHorizontal: space[4] }} tone="fg2">
					{t("empty")}
				</Text>
			) : (
				<ListGroup>
					{rows.map((item) => (
						<NeedsRow
							item={item}
							key={item.id}
							list={list}
							onLater={later}
							onOpen={open}
						/>
					))}
				</ListGroup>
			)}
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
