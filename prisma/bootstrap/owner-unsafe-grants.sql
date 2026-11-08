-- Every role membership that breaks the rules in owner-verify.sql, as the
-- REVOKE statement that removes it (by the grantor that made it, so a grant
-- made by someone other than the superuser goes too). Catalog reads only.
SELECT pg_catalog.format('REVOKE %I FROM %I GRANTED BY %I CASCADE',
                         g.rolname, m.rolname, gr.rolname) AS ddl
  FROM pg_catalog.pg_auth_members am
  JOIN pg_catalog.pg_roles g ON g.oid = am.roleid
  JOIN pg_catalog.pg_roles m ON m.oid = am.member
  JOIN pg_catalog.pg_roles gr ON gr.oid = am.grantor
 WHERE (m.rolname = 'retrospend_owner' AND g.rolname <> 'retrospend_app')
    OR m.rolname = 'retrospend_app';
