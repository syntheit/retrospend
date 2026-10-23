import * as z from "zod";
import { v1 } from "../common/meta";
import { idSchema, okSchema, timestampSchema } from "../core";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const profileSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		username: z.string(),
		email: z.string(),
		/** The uploaded picture, else the sign-in provider's, else null. */
		avatarUrl: z.string().nullable(),
		/** An email change waiting for the new address to confirm it. */
		pendingEmail: z
			.object({ email: z.string(), expiresAt: timestampSchema.nullable() })
			.nullable(),
		createdAt: timestampSchema,
	})
	.meta({ id: "Profile" });

export type ProfileDto = z.infer<typeof profileSchema>;

export const updateProfileSchema = z
	.object({
		name: z.string().trim().min(1).max(100),
		username: z
			.string()
			.min(1)
			.max(50)
			.regex(/^[a-zA-Z0-9]+$/, "Letters and numbers only"),
		email: z.email().max(254),
		/** Required to change the email address. */
		currentPassword: z.string().min(1).max(255),
	})
	.partial()
	.meta({ id: "UpdateProfile" });

export const profileUpdateResultSchema = profileSchema
	.extend({
		/** True when the new email waits for confirmation (pendingEmail). */
		emailChangePending: z.boolean(),
	})
	.meta({ id: "ProfileUpdateResult" });

/** Mirrors backgroundSettingsSchema in src/lib/background-settings.ts. */
export const profileBackgroundSchema = z
	.object({
		symbolSets: z.array(z.enum(["currency", "math", "finance"])).min(1),
		color: z.enum(["gray", "green", "blue", "purple", "orange", "gold"]),
		density: z.enum(["sparse", "medium", "dense"]),
		animation: z.enum(["static", "float", "pulse"]),
		opacity: z.enum(["subtle", "medium", "bold"]),
	})
	.meta({ id: "ProfileBackground" });

export const avatarUploadSchema = z.object({
	file: z.file().max(AVATAR_MAX_BYTES).meta({
		description: "JPEG, PNG, WebP or GIF; stored as a 400px square WebP.",
	}),
});

const TAG = ["Profile"];

export const profileContract = {
	get: v1
		.route({
			method: "GET",
			path: "/profile",
			operationId: "getProfile",
			tags: TAG,
			summary: "The caller's name, username, email and picture",
		})
		.meta({ scope: "read" })
		.output(profileSchema),
	update: v1
		.route({
			method: "PATCH",
			path: "/profile",
			operationId: "updateProfile",
			tags: TAG,
			summary: "Change name, username or email",
			description:
				"An email change needs currentPassword. When the server sends email, the new address must confirm it first (emailChangePending).",
		})
		.meta({ scope: "write:settings", event: "profile.updated" })
		.input(updateProfileSchema)
		.output(profileUpdateResultSchema),
	cancelEmailChange: v1
		.route({
			method: "DELETE",
			path: "/profile/pending-email",
			operationId: "cancelEmailChange",
			tags: TAG,
			summary: "Drop a pending email change",
		})
		.meta({ scope: "write:settings", event: "profile.email_change_cancelled" })
		.output(okSchema),
	setAvatar: v1
		.route({
			method: "PUT",
			path: "/profile/avatar",
			operationId: "setAvatar",
			tags: TAG,
			summary: "Upload a profile picture (multipart/form-data, field file)",
		})
		.meta({ scope: "write:settings", event: "profile.avatar_updated" })
		.input(avatarUploadSchema)
		.output(z.object({ avatarUrl: z.string() })),
	removeAvatar: v1
		.route({
			method: "DELETE",
			path: "/profile/avatar",
			operationId: "removeAvatar",
			tags: TAG,
			summary: "Remove the uploaded profile picture",
		})
		.meta({ scope: "write:settings", event: "profile.avatar_removed" })
		.output(okSchema),
	getBackground: v1
		.route({
			method: "GET",
			path: "/profile/background",
			operationId: "getProfileBackground",
			tags: TAG,
			summary: "The public profile page's background",
		})
		.meta({ scope: "read" })
		.output(profileBackgroundSchema),
	setBackground: v1
		.route({
			method: "PUT",
			path: "/profile/background",
			operationId: "setProfileBackground",
			tags: TAG,
			summary: "Change the public profile page's background",
		})
		.meta({ scope: "write:settings", event: "profile.background_updated" })
		.input(profileBackgroundSchema)
		.output(profileBackgroundSchema),
};
