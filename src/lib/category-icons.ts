import * as LucideIcons from "lucide-react";
import { type LucideIcon, Tag } from "lucide-react";

export const getCategoryIconName = (name: string): string => {
	const lowerName = name.toLowerCase();

	if (
		[
			"food",
			"dining",
			"restaurant",
			"eat",
			"cafe",
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

	return "Tag";
};

export const getCategoryIcon = (
	name: string,
	iconName?: string | null,
): LucideIcon => {
	const resolvedName = iconName || getCategoryIconName(name);

	const Icons = LucideIcons as unknown as Record<string, LucideIcon>;
	if (Icons[resolvedName]) {
		return Icons[resolvedName] as LucideIcon;
	}

	return Tag;
};
