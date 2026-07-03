ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notification_previews boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_visibility text NOT NULL DEFAULT 'everyone' CHECK (online_visibility IN ('everyone', 'contacts', 'nobody')),
  ADD COLUMN IF NOT EXISTS last_seen_visibility text NOT NULL DEFAULT 'everyone' CHECK (last_seen_visibility IN ('everyone', 'contacts', 'nobody')),
  ADD COLUMN IF NOT EXISTS show_typing_status boolean NOT NULL DEFAULT true;

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS device_name text,
  ADD COLUMN IF NOT EXISTS ip_address inet,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS user_sessions_revoked_at_idx ON user_sessions (revoked_at);

ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_permission text NOT NULL DEFAULT 'everyone' CHECK (send_permission IN ('everyone', 'admins')),
  ADD COLUMN IF NOT EXISTS edit_info_permission text NOT NULL DEFAULT 'admins' CHECK (edit_info_permission IN ('everyone', 'admins')),
  ADD COLUMN IF NOT EXISTS add_members_permission text NOT NULL DEFAULT 'admins' CHECK (add_members_permission IN ('everyone', 'admins')),
  ADD COLUMN IF NOT EXISTS change_image_permission text NOT NULL DEFAULT 'admins' CHECK (change_image_permission IN ('everyone', 'admins')),
  ADD COLUMN IF NOT EXISTS start_calls_permission text NOT NULL DEFAULT 'everyone' CHECK (start_calls_permission IN ('everyone', 'admins'));

UPDATE chats
SET owner_id = created_by
WHERE owner_id IS NULL AND type = 'group';

ALTER TABLE media_files
  DROP CONSTRAINT IF EXISTS media_files_purpose_check;

ALTER TABLE media_files
  ADD CONSTRAINT media_files_purpose_check CHECK (purpose IN ('message', 'avatar', 'group_avatar'));

ALTER TABLE invite_links
  ADD COLUMN IF NOT EXISTS token_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS token_encryption jsonb;

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_id_idx ON user_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS user_contact_nicknames (
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (length(trim(nickname)) > 0 AND length(nickname) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, target_user_id),
  CHECK (owner_user_id <> target_user_id)
);

CREATE TABLE IF NOT EXISTS qr_login_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  requester_user_agent text,
  requester_ip inet,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_session_id uuid REFERENCES user_sessions(id) ON DELETE SET NULL,
  session_token_hash text,
  session_expires_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qr_login_requests_expires_at_idx ON qr_login_requests (expires_at);
CREATE INDEX IF NOT EXISTS qr_login_requests_status_idx ON qr_login_requests (status);

CREATE TABLE IF NOT EXISTS call_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid REFERENCES chats(id) ON DELETE SET NULL,
  caller_id uuid REFERENCES users(id) ON DELETE SET NULL,
  callee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'accepted', 'rejected', 'ended', 'missed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS call_history_chat_id_idx ON call_history (chat_id);
CREATE INDEX IF NOT EXISTS call_history_callee_id_idx ON call_history (callee_id);
