import { z } from "zod";

export const backgroundSettingsSchema = z.object({
	symbolSets: z
		.array(z.enum(["currency", "math", "finance"]))
		.min(1, "At least one symbol set is required"),
	color: z.enum(["gray", "green", "blue", "purple", "orange", "gold"]),
	density: z.enum(["sparse", "medium", "dense"]),
	animation: z.enum(["static", "float", "pulse"]),
	opacity: z.enum(["subtle", "medium", "bold"]),
});

export type BackgroundSettings = z.infer<typeof backgroundSettingsSchema>;

export const defaultBackgroundSettings: BackgroundSettings = {
	symbolSets: ["currency"],
	color: "gray",
	density: "medium",
	animation: "pulse",
	opacity: "subtle",
};
