-- What must be true of retrospend_owner and retrospend_app, read from the
-- catalogs only (the rule in owner-role.sql). One row per problem; no rows
-- means all is well. scripts/db-owner runs it as the superuser after the role
-- is made, and as the owner when it signs in.
--   - the owner is no superuser and cannot create roles or databases or
--     replicate;
--   - the owner is a member of no role but retrospend_app, directly or through
--     another role, and in particular of no pg_* role (pg_execute_server_program,
--     pg_read_server_files, pg_write_server_files, pg_read_all_data ...), and of
--     no superuser or role-creating role;
--   - retrospend_app is a member of nothing.

WITH owner AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'retrospend_owner'),
     app AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'retrospend_app')
SELECT 'attribute ' || v.name AS problem
  FROM pg_catalog.pg_roles r
  CROSS JOIN LATERAL (VALUES
    ('superuser', r.rolsuper),
    ('createrole', r.rolcreaterole),
    ('createdb', r.rolcreatedb),
    ('replication', r.rolreplication)) AS v(name, bad)
 WHERE r.rolname = 'retrospend_owner' AND v.bad

UNION
SELECT 'owner is a member of ' || g.rolname
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
 WHERE m.member = (SELECT oid FROM owner) AND g.rolname <> 'retrospend_app'

UNION
SELECT 'retrospend_app is a member of ' || g.rolname
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
 WHERE m.member = (SELECT oid FROM app)

UNION
SELECT 'owner holds ' || g.rolname || ' (directly or through another role)'
  FROM pg_catalog.pg_roles g
 WHERE (g.rolsuper OR g.rolcreaterole OR g.rolname LIKE 'pg\_%')
   AND g.rolname <> 'retrospend_owner'
   AND pg_catalog.pg_has_role('retrospend_owner', g.oid, 'MEMBER')

ORDER BY 1;
