-- The three database roles and their grants (BLUEPRINT §4, "Database roles").
-- Idempotent and convergent: it creates missing roles, revokes everything, then grants exactly what is
-- listed here, so re-running it after every migration (db:migrate does) covers new tables too.
-- The roles are NOLOGIN groups. Each service logs in as its own login role that is a member of one of
-- these (`GRANT agent_worker TO <login role>`); passwords never appear in this repo.

do $$
begin
  if not exists (select from pg_roles where rolname = 'agent_worker') then create role agent_worker nologin; end if;
  if not exists (select from pg_roles where rolname = 'agent_gateway') then create role agent_gateway nologin; end if;
  if not exists (select from pg_roles where rolname = 'agent_dashboard') then create role agent_dashboard nologin; end if;
end
$$;

-- The dashboard reads outcomes through this view, which leaves out hashed_contact.
create or replace view dashboard_outcomes as
  select id, product_id, source_id, stage, occurred_at, value_micros, currency, is_test, ids,
         attributed_entity_id, attribution_method, fed_back_google_at, fed_back_meta_at, created_at
  from outcomes;

revoke all on all tables in schema public from agent_worker, agent_gateway, agent_dashboard;
grant usage on schema public to agent_worker, agent_gateway, agent_dashboard;

-- ── agent_worker: read and write everything, except the change log, which only the gateway writes.
grant select, insert, update, delete on all tables in schema public to agent_worker;
revoke insert, update, delete on change_log from agent_worker;

-- ── agent_gateway: read everything; write only what applying, recovering and undoing a change needs.
grant select on all tables in schema public to agent_gateway;
grant update on proposals to agent_gateway;
grant insert on change_log, notifications, credential_access to agent_gateway;
grant insert, update on credentials to agent_gateway;                  -- `ads-gw credentials put` and key rotation (M01b)
grant update (reverted_by_revision_id) on change_log to agent_gateway; -- links a change to the undo that reverted it
grant update (status) on products to agent_gateway;                    -- halts the product on needs_attention
-- `ads-gw revert` creates the undo proposal and its approval inside the gateway (BLUEPRINT §6, "Undo").
grant insert on proposals, proposal_versions, approvals to agent_gateway;
grant update on jobs to agent_gateway;                                 -- leases jobs on the 'gateway' queue (M01b)
grant insert, update on api_usage to agent_gateway;                    -- counts its own platform operations

-- ── agent_dashboard: read, minus credentials and hashed contact details; its only write is a request.
grant select on all tables in schema public to agent_dashboard;
revoke select on credentials, credential_access, outcomes from agent_dashboard;
grant insert on operator_requests to agent_dashboard;
