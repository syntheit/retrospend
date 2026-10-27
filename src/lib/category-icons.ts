import { categoryIconName } from "@retrospend/domain/category-icons";
import {
	Banknote,
	Briefcase,
	Bus,
	Car,
	Clapperboard,
	Coffee,
	CreditCard,
	Dog,
	Dumbbell,
	Gamepad2,
	Gift,
	GraduationCap,
	Hammer,
	Heart,
	HeartPulse,
	Home,
	Lamp,
	Landmark,
	type LucideIcon,
	Monitor,
	MoreHorizontal,
	Music,
	PackageOpen,
	Palette,
	Plane,
	Receipt,
	Repeat,
	Shirt,
	ShoppingBag,
	ShoppingBasket,
	Smartphone,
	Tag,
	Train,
	Users,
	Utensils,
	Wifi,
	Wine,
	Zap,
} from "lucide-react";

export const CATEGORY_ICON_REGISTRY: Record<string, LucideIcon> = {
	Banknote,
	Briefcase,
	Bus,
	Car,
	Clapperboard,
	Coffee,
	CreditCard,
	Dog,
	Dumbbell,
	Gamepad2,
	Gift,
	GraduationCap,
	Hammer,
	Heart,
	HeartPulse,
	Home,
	Lamp,
	Landmark,
	Monitor,
	MoreHorizontal,
	Music,
	PackageOpen,
	Palette,
	Plane,
	Receipt,
	Repeat,
	Shirt,
	ShoppingBag,
	ShoppingBasket,
	Smartphone,
	Tag,
	Train,
	Users,
	Utensils,
	Wifi,
	Wine,
	Zap,
};

const iconCache = new Map<string, LucideIcon>();

export const getCategoryIcon = (
	name: string,
	iconName?: string | null,
): LucideIcon => {
	const cacheKey = iconName ?? name;
	const cached = iconCache.get(cacheKey);
	if (cached) return cached;

	const icon = CATEGORY_ICON_REGISTRY[categoryIconName(name, iconName)] ?? Tag;
	iconCache.set(cacheKey, icon);
	return icon;
};
