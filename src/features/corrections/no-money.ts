/**
 * The places a fix request never touches (asking, answering, canceling move
 * no money): the preview block names them as staying, next to what the
 * server's dry run lists as unchanged.
 */
export const NO_MONEY = [
	"owed.owedToYou",
	"owed.youOwe",
	"spent",
	"accounts",
] as const;
