-- Custom SQL migration file, put your code below! --
ALTER TABLE spend_passes ADD CONSTRAINT spend_pass_amounts_valid CHECK (
  total_budget > 0 AND max_per_request > 0 AND max_per_request <= total_budget
  AND spent >= 0 AND reserved >= 0 AND spent + reserved <= total_budget
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_agent_binding() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.spend_pass_id IS NOT NULL AND NEW.spend_pass_id IS DISTINCT FROM OLD.spend_pass_id THEN
    RAISE EXCEPTION 'A Spend Pass credential cannot be detached or reassigned';
  END IF;
  IF NEW.spend_pass_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM spend_passes WHERE id = NEW.spend_pass_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Spend Pass and API key must belong to the same workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER api_key_spend_pass_binding BEFORE INSERT OR UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION protect_agent_binding();
