ALTER TABLE "operator_requests" ADD COLUMN "inserted_by" text DEFAULT current_user NOT NULL;--> statement-breakpoint
-- Wakes the worker when a request is recorded (M10a): the dashboard only records requests, through Neon's pooler,
-- and the worker LISTENs on its direct connection (it also polls, so a lost wake-up only delays a request).
CREATE OR REPLACE FUNCTION operator_request_queued() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('request_queued', NEW.id::text);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER operator_requests_queued AFTER INSERT ON operator_requests
  FOR EACH ROW WHEN (NEW.status = 'queued') EXECUTE FUNCTION operator_request_queued();
