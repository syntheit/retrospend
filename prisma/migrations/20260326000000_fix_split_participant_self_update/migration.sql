-- Fix: split_participant WITH CHECK clause missing self-update condition
--
-- The USING clause correctly allows a participant to READ their own record:
--   ("participantType" = 'user' AND "participantId" = current_user_id)
-- But the WITH CHECK clause (which governs INSERT/UPDATE) was missing this,
-- so a participant couldn't update their own record (e.g., accept/reject
-- verification) unless they were also the transaction owner or a project
-- participant. This caused "new row violates row-level security policy"
-- errors in the verification.queue endpoint.

DROP POLICY IF EXISTS "split_participant_access" ON "split_participant";
CREATE POLICY "split_participant_access" ON "split_participant"
    AS PERMISSIVE FOR ALL TO retrospend_app
    USING (
      ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
      OR is_transaction_owner("transactionId", current_setting('app.current_user_id', true))
      OR is_transaction_project_participant("transactionId", current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
      OR is_transaction_owner("transactionId", current_setting('app.current_user_id', true))
      OR is_transaction_project_participant("transactionId", current_setting('app.current_user_id', true))
    );
