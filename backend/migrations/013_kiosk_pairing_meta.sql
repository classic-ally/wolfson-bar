-- Who asked to pair: shown to the approving committee member so a pairing
-- started somewhere other than the bar PC is easier to spot.
ALTER TABLE kiosk_pairings ADD COLUMN client_ip TEXT;
ALTER TABLE kiosk_pairings ADD COLUMN user_agent TEXT;
