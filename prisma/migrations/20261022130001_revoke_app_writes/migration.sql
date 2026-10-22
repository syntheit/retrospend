-- 20260303000002_rls_hardening revoked writes on these tables from
-- retrospend_app, but the blanket re-grant in
-- 20260309000000_fix_retrospend_app_schema_usage handed them back.
-- Nothing writes them as retrospend_app: password reset tokens are written
-- by public and admin procedures on the owner connection, and exchange
-- rates and expired-token cleanup come from the sidecar, which connects as
-- the owner and never switches role. The app role keeps SELECT.

GRANT SELECT ON "exchange_rate" TO retrospend_app;
GRANT SELECT ON "password_reset_token" TO retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "exchange_rate" FROM retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "password_reset_token" FROM retrospend_app;
