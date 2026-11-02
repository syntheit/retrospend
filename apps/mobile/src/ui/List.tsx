import { categoryIconName } from "@retrospend/domain/category-icons";
import { mixOklab, type Rgba, toHex } from "@retrospend/tokens/color";
import {
	Children,
	createContext,
	Fragment,
	isValidElement,
	type ReactNode,
	useContext,
} from "react";
import { Pressable, View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { useFormatter, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { useFontScale } from "./fontScale";
import { categoryColor, Glyph, type GlyphName } from "./Glyph";
import { rowEnter, rowExit, rowLayout } from "./motion";
import { Text } from "./Text";
import { TextAction } from "./TextAction";

/**
 * A section title with its count (fg-3) or a link at its end. Flat, no card.
 * `detail` is the count or a short fact next to the title. `dot` leads the
 * title with a series dot (a wealth group) and `total` ends the row with the
 * section's figure, already formatted (a group's total); neither stacks with
 * an action.
 */
export function SectionHeader({
	title,
	detail,
	actionLabel,
	onAction,
	dot,
	total,
}: {
	title: string;
	detail?: string;
	actionLabel?: string;
	onAction?: () => void;
	dot?: ReactNode;
	total?: string;
}) {
	const { color, size, space, type } = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: dot || total ? "center" : "baseline",
				justifyContent: "space-between",
				gap: space[3],
				paddingHorizontal: space[4],
				paddingTop: space[6],
				paddingBottom: space[2],
			}}
		>
			<View
				style={{
					flex: 1,
					minWidth: 0,
					flexDirection: "row",
					alignItems: dot ? "center" : "baseline",
					gap: space[2],
				}}
			>
				{dot}
				<Text
					accessibilityRole="header"
					numberOfLines={1}
					style={{ flexShrink: 1 }}
					variant="section"
				>
					{title}
				</Text>
				{detail ? (
					<Text tabular tone="fg3">
						{detail}
					</Text>
				) : null}
			</View>
			{total ? (
				<Text tabular tone="fg2" weight="medium">
					{total}
				</Text>
			) : null}
			{actionLabel && onAction ? (
				<Pressable
					accessibilityRole="button"
					hitSlop={(size.touchMin.phone - type.small.size) / 2}
					onPress={onAction}
				>
					<Text
						style={{ color: color.accentStrong }}
						variant="small"
						weight="medium"
					>
						{actionLabel}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}

/** Said when the screen shows what the phone kept, because the server did not answer. */
export function StaleNote({ since }: { since: string | null }) {
	const t = useTranslations("mobile.activity");
	const format = useFormatter();
	const { space } = useTheme();
	if (!since) return null;
	return (
		<Text
			style={{ paddingHorizontal: space[4], paddingVertical: space[2] }}
			tone="fg2"
			variant="small"
		>
			{t("offlineSince", {
				time: format.dateTime(new Date(since), {
					dateStyle: "medium",
					timeStyle: "short",
				}),
			})}
		</Text>
	);
}

/** The category a row names: its icon key and its color slot (1 to 21). */
export interface CategoryRef {
	name: string | null;
	icon: string | null;
	tone: number;
}

const tints = new Map<string, string>();

/** A theme color (`#rrggbb` or `#rrggbbaa`) as sRGB channels. */
function fromHex(hex: string): Rgba {
	const n = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
	return { r: n(1), g: n(3), b: n(5), a: hex.length > 7 ? n(7) : 1 };
}

/**
 * A tile's fill: the category color at 15% over the surface, mixed in OKLab
 * the way the web tile mixes it (`color-mix(in oklab, c 15%, surface)`).
 * Both ends are tokens, so the tint follows the theme.
 */
export function tileTint(base: string, surface: string): string {
	const key = `${base}/${surface}`;
	let tint = tints.get(key);
	if (!tint) {
		tint = toHex(mixOklab(fromHex(base), 15, fromHex(surface)));
		tints.set(key, tint);
	}
	return tint;
}

/**
 * The category as a tinted tile with its glyph, on its own category color.
 * It says only "which category" (GUIDELINE 2.1) and sits in list rows only;
 * pickers and menus show the bare glyph. A row with no category gets the
 * neutral tile and `fallback` (a payment is a banknote).
 */
export function CategoryTile({
	category,
	fallback = "Tag",
}: {
	category: CategoryRef | null;
	fallback?: GlyphName;
}) {
	const { color, radius, size } = useTheme();
	const base = category ? categoryColor(color, category.tone) : null;
	const tile = size.avatar.default;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: tile,
				height: tile,
				borderRadius: radius.ctl,
				backgroundColor: base ? tileTint(base, color.surface) : color.raised,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Glyph
				color={base ?? color.fg2}
				name={
					category?.name || category?.icon
						? categoryIconName(category.name ?? "", category.icon)
						: fallback
				}
				size={size.icon.phone}
			/>
		</View>
	);
}

/** Set by ListGroup: its rows sit on the surface and it draws the hairlines. */
const InGroup = createContext(false);

/** Set by `<ListGroup form>`: its row titles read at 400, like iOS Settings. */
const InForm = createContext(false);

/** Children flattened through arrays and fragments, so each row is one item. */
function rowsOf(children: ReactNode): ReactNode[] {
	const out: ReactNode[] = [];
	Children.forEach(children, (child) => {
		if (child === null || child === undefined || child === false) return;
		if (isValidElement(child) && child.type === Fragment) {
			out.push(...rowsOf((child.props as { children?: ReactNode }).children));
		} else {
			out.push(child);
		}
	});
	return out;
}

/**
 * An inset group of rows (the iOS inset list): the surface, a 1px line
 * edge, the panel radius and a hairline between rows, none after the last.
 * Put ListRows inside (SkeletonRows brings its own group); the group sits
 * in the page gutter.
 *
 * Rows that join or leave a group already on screen animate (200): a new
 * row fades in, a removed one fades out, and the rows and the group's edge
 * slide to their place (reduced motion: the fades only). Rows that arrive
 * with the group (the first load, a list mounting rows as it scrolls) and
 * rows leaving with it do not animate. Keyed rows animate as themselves.
 */
export function ListGroup({
	children,
	accessibilityLabel,
	form,
	wrapRow,
}: {
	children: ReactNode;
	accessibilityLabel?: string;
	/** A group of settings or form values: row titles at 400, not 500. */
	form?: boolean;
	/**
	 * Draws each row's wrapper (the hairline above it and the row) itself, in
	 * place of the group's fade and slide: a list the person reorders by
	 * dragging moves its rows on its own.
	 */
	wrapRow?: (props: { index: number; children: ReactNode }) => ReactNode;
}) {
	const theme = useTheme();
	const { color, radius, size } = theme;
	const rows = rowsOf(children);
	if (rows.length === 0) return null;
	return (
		<Animated.View
			accessibilityLabel={accessibilityLabel}
			layout={rowLayout(theme)}
			style={{
				marginHorizontal: size.gutter.phone,
				backgroundColor: color.surface,
				borderWidth: 1,
				borderColor: color.line,
				borderRadius: radius.panel,
				overflow: "hidden",
			}}
		>
			<InGroup.Provider value={true}>
				<InForm.Provider value={form === true}>
					<LayoutAnimationConfig skipEntering skipExiting>
						{rows.map((row, index) =>
							wrapRow ? (
								<Fragment
									key={
										isValidElement(row) && row.key !== null
											? `key:${row.key}`
											: `at:${index}`
									}
								>
									{wrapRow({
										index,
										children: (
											<>
												{index > 0 ? (
													<View
														style={{ height: 1, backgroundColor: color.line }}
													/>
												) : null}
												{row}
											</>
										),
									})}
								</Fragment>
							) : (
								<Animated.View
									entering={rowEnter(theme)}
									exiting={rowExit(theme)}
									key={
										isValidElement(row) && row.key !== null
											? `key:${row.key}`
											: `at:${index}`
									}
									layout={rowLayout(theme)}
								>
									{index > 0 ? (
										<View style={{ height: 1, backgroundColor: color.line }} />
									) : null}
									{row}
								</Animated.View>
							),
						)}
					</LayoutAnimationConfig>
				</InForm.Provider>
			</InGroup.Provider>
		</Animated.View>
	);
}

/**
 * One row of a group that a virtualized list draws row by row (a FlatList
 * item per row): the same surface, 1px edge, panel radius at the ends and
 * hairline between rows as ListGroup, without its row animations.
 */
export function ListGroupItem({
	children,
	index,
	count,
}: {
	children: ReactNode;
	index: number;
	count: number;
}) {
	const { color, radius, size } = useTheme();
	const first = index === 0;
	const last = index === count - 1;
	return (
		<View
			style={{
				marginHorizontal: size.gutter.phone,
				backgroundColor: color.surface,
				borderColor: color.line,
				borderLeftWidth: 1,
				borderRightWidth: 1,
				borderTopWidth: first ? 1 : 0,
				borderBottomWidth: last ? 1 : 0,
				borderTopLeftRadius: first ? radius.panel : 0,
				borderTopRightRadius: first ? radius.panel : 0,
				borderBottomLeftRadius: last ? radius.panel : 0,
				borderBottomRightRadius: last ? radius.panel : 0,
				overflow: "hidden",
			}}
		>
			<InGroup.Provider value={true}>
				{first ? null : (
					<View style={{ height: 1, backgroundColor: color.line }} />
				)}
				{children}
			</InGroup.Provider>
		</View>
	);
}

/** True inside a ListGroup: a row there sits on the surface. */
export function useInGroup(): boolean {
	return useContext(InGroup);
}

/** The text scale from which a row title wraps instead of ending in an ellipsis. */
export const WRAP_FROM_SCALE = 1.3;

/**
 * The middle of a row: the title (14/500) over a sub line (12, fg-3). Either
 * can be a string or a node (a StatusText, a stack of faces).
 */
export function RowText({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
	const form = useContext(InForm);
	// At the largest text sizes a title wraps whole words instead of ending in an ellipsis.
	const fontScale = useFontScale();
	const titleLines = fontScale > WRAP_FROM_SCALE ? undefined : 1;
	return (
		<View style={{ flex: 1, minWidth: 0 }}>
			{typeof title === "string" ? (
				<Text numberOfLines={titleLines} weight={form ? "normal" : "medium"}>
					{title}
				</Text>
			) : (
				title
			)}
			{sub === undefined || sub === null ? null : typeof sub === "string" ? (
				<Text numberOfLines={1} tone="fg3" variant="meta">
					{sub}
				</Text>
			) : (
				sub
			)}
		</View>
	);
}

/**
 * A tappable list row at the 44pt minimum. With `title` it lays out the lead,
 * the title over the sub line, and the end (money, a chevron); with children
 * it lays them out in one line. Inside a ListGroup it sits on the surface and
 * the group draws the hairlines; on its own it draws a hairline under itself.
 * A selected row takes the brand-soft fill.
 */
export function ListRow({
	children,
	lead,
	title,
	sub,
	end,
	chevron,
	onPress,
	onLongPress,
	selected,
	pickState,
	accessibilityLabel,
}: {
	children?: ReactNode;
	/** A tile, a face or a cover at the start. */
	lead?: ReactNode;
	title?: ReactNode;
	sub?: ReactNode;
	/** Money, a status or a chevron at the end. */
	end?: ReactNode;
	/** The disclosure chevron after `end`: the row opens something. */
	chevron?: boolean;
	onPress?: () => void;
	onLongPress?: () => void;
	selected?: boolean;
	/** While expenses are picked: a row that cannot join is disabled, the others are checkboxes. */
	pickState?: { checked: boolean; enabled: boolean };
	accessibilityLabel?: string;
}) {
	const { color, size, space } = useTheme();
	const inGroup = useInGroup();
	const rest = inGroup ? color.surface : color.bg;
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel}
			accessibilityRole={
				pickState ? "checkbox" : onPress ? "button" : undefined
			}
			accessibilityState={
				pickState
					? { checked: pickState.checked, disabled: !pickState.enabled }
					: selected
						? { selected: true }
						: undefined
			}
			disabled={!onPress}
			onLongPress={onLongPress}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: size.row.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				paddingHorizontal: space[4],
				paddingVertical: space[2],
				backgroundColor: selected
					? color.brandSoft
					: pressed
						? color.raised
						: rest,
				...(inGroup
					? null
					: { borderBottomWidth: 1, borderBottomColor: color.line }),
			})}
		>
			{lead}
			{title !== undefined ? <RowText sub={sub} title={title} /> : null}
			{children}
			{end}
			{chevron ? <Chevron /> : null}
		</Pressable>
	);
}

/** The disclosure chevron at a row's end (fg-3). */
function Chevron() {
	const { color, size } = useTheme();
	return <Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />;
}

/**
 * The end of a navigating or choosing row: its value in fg-2, then the
 * chevron. `lead` puts an identity mark (a flag, a face, a dot) before the
 * value.
 */
export function NavEnd({
	value,
	lead,
	chevron = true,
	capped = true,
}: {
	value?: string;
	lead?: ReactNode;
	/** False for a value the row shows but cannot open. */
	chevron?: boolean;
	/**
	 * False when a wrapper around this end already caps its width (a percent
	 * of a shrink-wrapped parent resolves against the content and squeezes
	 * the value to a stub).
	 */
	capped?: boolean;
}) {
	const { space } = useTheme();
	return (
		<View
			style={{
				flexShrink: 1,
				// A long value gives way before the row's label does.
				maxWidth: capped ? "65%" : undefined,
				flexDirection: "row",
				alignItems: "center",
				gap: space[2],
			}}
		>
			{lead}
			{value ? (
				<Text numberOfLines={1} style={{ flexShrink: 1 }} tone="fg2">
					{value}
				</Text>
			) : null}
			{chevron ? <Chevron /> : null}
		</View>
	);
}

/**
 * A row of an inset group that holds a control of its own (the date picker,
 * a switch, the rate line). It is a plain view, not a list row: a list row is
 * one accessibility element, which would hide the control inside it from a
 * screen reader.
 */
export function GroupItem({ children }: { children: ReactNode }) {
	const { size, space } = useTheme();
	return (
		<View
			style={{
				minHeight: size.row.phone,
				justifyContent: "center",
				paddingHorizontal: space[4],
				paddingVertical: space[1],
			}}
		>
			{children}
		</View>
	);
}

/** A text button on its own line (Show more, Show fewer), in line with the rows. */
export function LinkButton({
	label,
	onPress,
}: {
	label: string;
	onPress: () => void;
}) {
	return <TextAction inset label={label} onPress={onPress} />;
}
