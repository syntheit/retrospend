/**
 * Who lives in the e2e test DB. A port of the staging personas
 * (.staging/seed-demo.mjs) and the mockup ledger (Lucía, Martín, Paz): Sofía
 * keeps an ARS home with some USD spending, shares a Florianópolis trip in
 * BRL, splits the apartment bills with Martín and owes or is owed by friends
 * outside any project. All names, emails and passwords are fake.
 *
 * Ids are fixed so tests and figure ids can name rows directly.
 */

export const SEED_TIME_ZONE = "America/Argentina/Buenos_Aires";

export interface SeedUser {
	id: string;
	name: string;
	username: string;
	email: string;
	password: string;
	/** App language; English when omitted. */
	language?: string;
}

export const SOFIA: SeedUser = {
	id: "e2e_user_sofia",
	name: "Sofía Reyes",
	username: "sofia",
	email: "sofia.reyes@example.com",
	password: "Sofia-e2e-2026!",
};

export const LUCIA: SeedUser = {
	id: "e2e_user_lucia",
	name: "Lucía Fernández",
	username: "lucia",
	email: "lucia.fernandez@example.com",
	password: "Lucia-e2e-2026!",
	// Lucía reads the app in Spanish (the es-AR pass of the smoke flow).
	language: "es-AR",
};

export const MARTIN: SeedUser = {
	id: "e2e_user_martin",
	name: "Martín Acosta",
	username: "martin",
	email: "martin.acosta@example.com",
	password: "Martin-e2e-2026!",
};

export const SEED_USERS = [SOFIA, LUCIA, MARTIN] as const;

/** Paz is not on Retrospend: a shadow profile Sofía created. */
export const PAZ = {
	id: "e2e_shadow_paz",
	name: "Paz Ibarra",
	createdById: SOFIA.id,
} as const;

export const PROJECT_IDS = {
	floripa: "e2e_project_floripa",
	depto: "e2e_project_depto",
} as const;

export type ParticipantRef = {
	participantType: "user" | "shadow";
	participantId: string;
};

export const ref = {
	sofia: { participantType: "user", participantId: SOFIA.id },
	lucia: { participantType: "user", participantId: LUCIA.id },
	martin: { participantType: "user", participantId: MARTIN.id },
	paz: { participantType: "shadow", participantId: PAZ.id },
} as const satisfies Record<string, ParticipantRef>;

export type PersonKey = keyof typeof ref;
