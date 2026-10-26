/**
 * The push settings for the Environment Variables page. Kept apart so the
 * page does not grow; the shape is the page's own EnvGroup.
 */
export const PUSH_ENV_GROUP: {
	title: string
	id: string
	vars: {
		name: string
		required: boolean
		default?: string
		description: string
	}[]
} = {
	title: "Push notifications",
	id: "push",
	vars: [
		{
			name: "VAPID_PRIVATE_KEY",
			required: false,
			description:
				"Turns on push to Android phones through UnifiedPush (for example the ntfy app). A base64url P-256 private key; the command that makes one is in .env.example. Keep it: a new key makes every phone register again.",
		},
		{
			name: "VAPID_PUBLIC_KEY",
			required: false,
			default: "derived",
			description:
				"The matching public key. Optional; if set it must belong to VAPID_PRIVATE_KEY.",
		},
		{
			name: "VAPID_SUBJECT",
			required: false,
			default: "PUBLIC_URL when https",
			description:
				"A mailto: or https: contact that push services may use to reach you.",
		},
		{
			name: "PUSH_ENDPOINT_ALLOW_HOSTS",
			required: false,
			description:
				"Comma-separated hosts (names or IPs) that may receive push although they are on a private network, such as a ntfy server on your LAN. Without it, an endpoint on a private address is refused, unless an admin has turned on Allow private webhook targets, which also allows private UnifiedPush endpoints.",
		},
		{
			name: "APNS_KEY_ID",
			required: false,
			description:
				"Key ID of your Apple push key. All four APNs settings are needed for iPhone and iPad push.",
		},
		{
			name: "APNS_TEAM_ID",
			required: false,
			description: "Your Apple developer Team ID.",
		},
		{
			name: "APNS_BUNDLE_ID",
			required: false,
			description: "The bundle ID of the Retrospend app you built.",
		},
		{
			name: "APNS_KEY",
			required: false,
			description:
				"The contents of the .p8 key, with newlines written as \\n. Or set APNS_KEY_FILE to its path.",
		},
		{
			name: "FCM_SERVICE_ACCOUNT",
			required: false,
			description:
				"A Firebase service account key (JSON), for Android phones with Google Play services. Or set FCM_SERVICE_ACCOUNT_FILE to its path.",
		},
		{
			name: "FCM_PROJECT_ID",
			required: false,
			default: "from the key",
			description: "The Firebase project, if it differs from the key's.",
		},
	],
}
