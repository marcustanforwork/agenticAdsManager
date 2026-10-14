CREATE TABLE "telegram_conversations" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
