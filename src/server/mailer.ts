import nodemailer from "nodemailer";
import { env } from "~/env";

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    })
  : null;

import { getAppSettings } from "~/server/services/settings";

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  bypassEnabledCheck = false,
) {
  if (!transporter) {
    console.log(
      `[Email Skipped]: SMTP not configured. Would have sent "${subject}" to ${to}`,
    );
    return;
  }

  if (!bypassEnabledCheck) {
    const settings = await getAppSettings();
    if (!settings.enableEmail) {
      console.log(
        `[Email Skipped]: Email disabled by admin. Would have sent "${subject}" to ${to}`,
      );
      return;
    }
  }

  try {
    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error("[Email Error]: Failed to send email.", error);
  }
}
