-- Add UPDATE and DELETE RLS policies for the feedback table (defense-in-depth)
-- The retrospend_app role can update and delete feedback rows.

-- Users can update their own feedback
DROP POLICY IF EXISTS "feedback_update_own" ON "feedback";
CREATE POLICY "feedback_update_own" ON "feedback"
    FOR UPDATE
    TO retrospend_app
    USING ("userId" = current_setting('app.current_user_id', true));

-- Users can delete their own feedback
DROP POLICY IF EXISTS "feedback_delete_own" ON "feedback";
CREATE POLICY "feedback_delete_own" ON "feedback"
    FOR DELETE
    TO retrospend_app
    USING ("userId" = current_setting('app.current_user_id', true));
