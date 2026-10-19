ALTER TABLE "operator_requests" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_requests" ADD COLUMN "retry_after" timestamp with time zone;
--> statement-breakpoint
-- F2: the `request_queued` wake-up fires at commit, and only for a row still queued then. Telegram and the CLIs
-- record and process a request in one transaction, so it is done by commit and wakes nobody; a dashboard insert is
-- still queued and wakes the worker as before. A rolled-back insert never notifies (NOTIFY is transactional anyway).
CREATE OR REPLACE FUNCTION operator_request_queued() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM operator_requests WHERE id = NEW.id AND status = 'queued') THEN
    PERFORM pg_notify('request_queued', NEW.id::text);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER operator_requests_queued ON operator_requests;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER operator_requests_queued AFTER INSERT ON operator_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'queued') EXECUTE FUNCTION operator_request_queued();
