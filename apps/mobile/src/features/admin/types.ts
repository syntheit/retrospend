import type { RetrospendClient } from "@retrospend/api-client";

type Admin = RetrospendClient["admin"];

export type AdminUser = Awaited<
	ReturnType<Admin["listUsers"]>
>["items"][number];
export type AdminFeedback = Awaited<
	ReturnType<Admin["listFeedback"]>
>["items"][number];
export type FeedbackPage = Awaited<ReturnType<Admin["listFeedback"]>>;
export type ServerSettings = Awaited<ReturnType<Admin["getSettings"]>>;

export type { InviteCodeDto } from "@retrospend/api-contract";
