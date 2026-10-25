import * as z from "zod";
import { v1 } from "../common/meta";
import { idSchema, okSchema } from "../core";

const TAG = ["Account"];

export const accountDeletionPreviewSchema = z
	.object({
		/** Projects you organize alone that another member takes over. */
		projectsToTransfer: z.array(
			z.object({
				id: idSchema,
				name: z.string(),
				newOrganizerName: z.string(),
			}),
		),
		/** Projects you organize alone with nobody to hand them to: they are deleted. */
		projectsToDelete: z.array(z.object({ id: idSchema, name: z.string() })),
		/** Payments waiting for an answer that are confirmed for the other person. */
		settlementsToAutoConfirm: z.int().min(0),
		/** Payments nobody confirmed yet that are cancelled. */
		settlementsToCancel: z.int().min(0),
		/** Shares waiting for your answer that are accepted. */
		verificationsToAutoAccept: z.int().min(0),
		/** Shared expenses you paid or added that keep your share as "Deleted User". */
		sharedTransactionsToAnonymize: z.int().min(0),
	})
	.meta({ id: "AccountDeletionPreview" });

export const deleteAccountSchema = z
	.object({
		password: z.string().min(1).max(255).meta({
			description:
				"Your account password. An account without one (social sign-in only) cannot be deleted here.",
		}),
	})
	.meta({ id: "DeleteAccount" });

export const recordConsentSchema = z
	.object({
		consentVersion: z.string().min(1).max(20).meta({
			description: "The version of the terms and privacy policy that was shown.",
		}),
	})
	.meta({ id: "RecordConsent" });

/**
 * Deleting your own account, which the App Store requires inside the app.
 * Only a signed-in web or mobile session may do it (scope `account:delete`):
 * an API key, a device session or any token is refused, whatever it holds.
 * The password is asked again every time.
 */
export const accountContract = {
	recordConsent: v1
		.route({
			method: "POST",
			path: "/me/consent",
			operationId: "recordConsent",
			tags: TAG,
			summary: "Record that you accepted the terms and privacy policy",
			description:
				"Call it right after sign-up when the server shows legal pages. Stores the time, the version and your address.",
		})
		.meta({ scope: "write:settings", event: "profile.consent_recorded" })
		.input(recordConsentSchema)
		.output(okSchema),
	deletionPreview: v1
		.route({
			method: "GET",
			path: "/me/deletion",
			operationId: "previewMyAccountDeletion",
			tags: TAG,
			summary: "What deleting your account would change for other people",
			description:
				"Reads only. Show it before asking for the password: projects handed over or deleted, and payments and shares settled on your way out.",
		})
		.meta({ scope: "read" })
		.output(accountDeletionPreviewSchema),
	delete: v1
		.route({
			method: "POST",
			path: "/me/deletion",
			operationId: "deleteMyAccount",
			tags: TAG,
			summary: "Delete your account for good",
			description:
				"Needs the account:delete scope (the app's own sign-in; never a token) and the password. Admins cannot delete their own account. Your data and files are removed; shared expenses keep your share as Deleted User. This cannot be undone and signs you out everywhere.",
		})
		.meta({ scope: "account:delete", event: "user.deleted" })
		.input(deleteAccountSchema)
		.output(okSchema),
};
