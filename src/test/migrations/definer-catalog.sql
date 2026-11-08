-- The function grants the definer hygiene migration touches, as one JSON value: every non-extension
-- function in public (mode, search_path, ACL) and the function default
-- privileges. Used by definer-rollback.pg.test.ts, and to regenerate
-- definer-catalog.before.json (see the note in that test). A function with a
-- NULL ACL is read as the default ACL it stands for (owner and PUBLIC).
SELECT jsonb_pretty(jsonb_build_object(
  'functions', (
    SELECT coalesce(jsonb_agg(f ORDER BY f->>'sig'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'sig', p.oid::regprocedure::text,
        'definer', p.prosecdef,
        'config', coalesce(array_to_string(p.proconfig, ';'), ''),
        'acl', (
          SELECT string_agg(
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' WHEN a.grantee = p.proowner THEN '<owner>' ELSE pg_get_userbyid(a.grantee) END
                     || ':' || a.privilege_type
                     || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
                   ',' ORDER BY (a.grantee <> 0), (a.grantee <> p.proowner), pg_get_userbyid(a.grantee), a.privilege_type)
          FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        )
      ) AS f
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
        )
    ) fs
  ),
  'defaults', (
    SELECT coalesce(jsonb_agg(
             jsonb_build_object(
               'role', pg_get_userbyid(defaclrole)::text,
               'schema', defaclnamespace::text,
               'acl', defaclacl::text)
             ORDER BY pg_get_userbyid(defaclrole)::text, defaclnamespace::text), '[]'::jsonb)
    FROM pg_default_acl
    WHERE defaclobjtype = 'f'
  )
));
