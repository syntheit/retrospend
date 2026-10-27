/**
 * Which glyph a category wears, for every client: the web draws it with
 * lucide-react, the apps from the same lucide shapes. A category stores an
 * icon key (one of CATEGORY_ICON_NAMES); with none, the name's usual glyph.
 */
export const CATEGORY_ICON_NAMES = [
	"Banknote",
	"Briefcase",
	"Bus",
	"Car",
	"Clapperboard",
	"Coffee",
	"CreditCard",
	"Dog",
	"Dumbbell",
	"Gamepad2",
	"Gift",
	"GraduationCap",
	"Hammer",
	"Heart",
	"HeartPulse",
	"Home",
	"Lamp",
	"Landmark",
	"Monitor",
	"MoreHorizontal",
	"Music",
	"PackageOpen",
	"Palette",
	"Plane",
	"Receipt",
	"Repeat",
	"Shirt",
	"ShoppingBag",
	"ShoppingBasket",
	"Smartphone",
	"Tag",
	"Train",
	"Users",
	"Utensils",
	"Wifi",
	"Wine",
	"Zap",
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number];

const KNOWN = new Set<string>(CATEGORY_ICON_NAMES);

/** The glyph a category uses: its stored key if known, else the one its name suggests. */
export function categoryIconName(
	name: string,
	icon?: string | null,
): CategoryIconName {
	if (icon && KNOWN.has(icon)) return icon as CategoryIconName;
	return guessCategoryIconName(name) as CategoryIconName;
}

/** The glyph a category name usually gets, "Tag" when nothing fits. */
export const guessCategoryIconName = (name: string): string => {
	const lowerName = name.toLowerCase();

	if (["cafe", "coffee"].some((k) => lowerName.includes(k))) {
		return "Coffee";
	}
	if (
		[
			"food",
			"dining",
			"restaurant",
			"eat",
			"dinner",
			"lunch",
			"breakfast",
		].some((k) => lowerName.includes(k))
	) {
		return "Utensils";
	}
	if (
		["grocery", "supermarket", "groceries", "market"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "ShoppingBasket";
	}
	if (
		["rent", "mortgage", "home", "housing", "apartment"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "Home";
	}
	if (
		[
			"transport",
			"gas",
			"uber",
			"car",
			"auto",
			"fuel",
			"taxi",
			"bus",
			"train",
		].some((k) => lowerName.includes(k))
	) {
		return "Car";
	}
	if (
		["utility", "bill", "electric", "power"].some((k) => lowerName.includes(k))
	) {
		return "Zap";
	}
	if (
		["internet", "phone", "wifi", "mobile", "broadband"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "Wifi";
	}
	if (
		["health", "doctor", "medical", "pharmacy"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "HeartPulse";
	}
	if (
		["gym", "fitness", "workout", "sport"].some((k) => lowerName.includes(k))
	) {
		return "Dumbbell";
	}
	if (
		["shopping", "clothing", "clothes", "apparel"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "ShoppingBag";
	}
	if (
		["travel", "flight", "plane", "hotel", "vacation", "trip"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "Plane";
	}
	if (["delivery", "takeout", "takeaway"].some((k) => lowerName.includes(k))) {
		return "PackageOpen";
	}
	if (
		["drinks", "bar", "beer", "wine", "cocktail"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "Wine";
	}
	if (
		["subscription", "recurring", "membership"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "Repeat";
	}
	if (
		["education", "school", "course", "tuition", "learning"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "GraduationCap";
	}
	if (
		["fee", "fees", "charge", "commission"].some((k) => lowerName.includes(k))
	) {
		return "Receipt";
	}
	if (["tax", "taxes"].some((k) => lowerName.includes(k))) {
		return "Landmark";
	}
	if (["social", "friends", "party"].some((k) => lowerName.includes(k))) {
		return "Users";
	}
	if (["date", "romance"].some((k) => lowerName.includes(k))) {
		return "Heart";
	}
	if (
		["household", "cleaning", "furniture", "home supplies"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "Lamp";
	}
	if (["hobby", "craft", "creative"].some((k) => lowerName.includes(k))) {
		return "Palette";
	}
	if (
		["entertainment", "movies", "concert", "gaming", "fun"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "Clapperboard";
	}
	if (["gift", "gifts", "present"].some((k) => lowerName.includes(k))) {
		return "Gift";
	}
	if (
		["electronics", "gadget", "device", "computer"].some((k) =>
			lowerName.includes(k),
		)
	) {
		return "Smartphone";
	}
	if (["other", "misc"].some((k) => lowerName.includes(k))) {
		return "MoreHorizontal";
	}

	return "Tag";
};
