/**
 * The metadata keys the server's own events write (admin actions, sign-in,
 * username changes, guest migration, imports): ids, flags, counts and
 * account identifiers. Anything else is dropped, so an event that later
 * carries a name a user typed (a shadow profile, a guest, a file) never
 * reaches an admin here. Add a key only after checking it holds no user text.
 * Kept free of imports so the log hygiene test (src/test/logHygiene) can read
 * it: every event written with a metadata key outside this set fails there.
 */
export const EVENT_METADATA_KEYS: ReadonlySet<string> = new Set([
	"action",
	"adminId",
	"adminUsername",
	"changedBy",
	"changedByUsername",
	"claimedShadowProfiles",
	"deletedBy",
	"deletedByUsername",
	"disabledBy",
	"disabledByUsername",
	"duration_ms",
	"email",
	"enabledBy",
	"enabledByUsername",
	"field",
	"fileSize",
	"fileType",
	"generatedBy",
	"generatedByUsername",
	"inviteCode",
	"migratedSessions",
	"newUsername",
	"newValue",
	"oldValue",
	"previousUsername",
	"projectIds",
	"reason",
	"resetBy",
	"resetByUsername",
	"role",
	"sessionId",
	"status",
	"targetEmail",
	"targetUsername",
	"updatedBy",
	"updatedByUsername",
	"username",
	"verifiedBy",
	"verifiedByUsername",
	"view",
]);
