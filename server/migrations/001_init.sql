CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  is_first_admin boolean NOT NULL DEFAULT false,
  must_change_credentials boolean NOT NULL DEFAULT false,
  is_banned boolean NOT NULL DEFAULT false,
  is_disabled boolean NOT NULL DEFAULT false,
  language text NOT NULL DEFAULT 'en',
  show_read_receipts boolean NOT NULL DEFAULT true,
  show_online_status boolean NOT NULL DEFAULT true,
  default_disappearing_seconds integer,
  public_key_jwk jsonb,
  encrypted_private_key_jwk jsonb,
  avatar_media_id uuid,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));
CREATE INDEX IF NOT EXISTS users_admin_idx ON users (is_admin);

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('direct', 'group')),
  name text,
  avatar_media_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  disappearing_seconds integer,
  pinned_message_id uuid,
  direct_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chats_type_idx ON chats (type);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_members_user_id_idx ON chat_members (user_id);

CREATE TABLE IF NOT EXISTS chat_member_keys (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_key jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id uuid REFERENCES users(id) ON DELETE SET NULL,
  chat_id uuid REFERENCES chats(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  encrypted_blob boolean NOT NULL DEFAULT true,
  server_encryption jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  purpose text NOT NULL DEFAULT 'message' CHECK (purpose IN ('message', 'avatar')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS media_files_chat_id_idx ON media_files (chat_id);
CREATE INDEX IF NOT EXISTS media_files_deleted_at_idx ON media_files (deleted_at);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  media_id uuid REFERENCES media_files(id) ON DELETE SET NULL,
  message_type text NOT NULL CHECK (message_type IN ('text', 'image', 'video', 'audio', 'file')),
  encrypted_payload jsonb,
  payload_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz,
  deleted_for_everyone_at timestamptz,
  client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);

CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_expires_at_idx ON messages (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_media_id_idx ON messages (media_id);

CREATE TABLE IF NOT EXISTS message_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  editor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  encrypted_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_deletions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses > 0),
  use_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_links_expires_at_idx ON invite_links (expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_idx ON admin_audit_logs (created_at DESC);
