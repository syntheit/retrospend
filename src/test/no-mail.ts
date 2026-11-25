/**
 * The mail settings every test run forces, whatever .env it picks up: with no
 * SMTP host the mailer builds no transport and sends nothing
 * (src/server/mailer.ts). A run that loaded a real .env once sent real mail
 * through the owner's account until the provider blocked it (2026-11-25).
 */
export const NO_MAIL = {
	SMTP_HOST: "",
	SMTP_PORT: "",
	SMTP_USER: "",
	SMTP_PASSWORD: "",
} as const;
