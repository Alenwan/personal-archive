export interface HyperdriveBinding {
  connectionString: string;
}

export interface AppEnv {
  HYPERDRIVE?: HyperdriveBinding;
  DOCUMENT_BUCKET?: R2Bucket;
  BACKUP_BUCKET?: R2Bucket;
  SESSION_SECRET?: string;
  DEMO_PASSWORD?: string;
  CLIENT_DEMO_PASSWORD?: string;
  INTERNAL_ADMIN_PASSWORD?: string;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  MANUSCRIPT_RECOVERY_KEY?: string;
  PRIVATE_VAULT_RECOVERY_KEY?: string;
  APP_ENV?: string;
  BUSINESS_TEMPLATE?: string;
  PBX_AMI_ENABLED?: string;
  PBX_AMI_HOST?: string;
  PBX_AMI_PORT?: string;
  PBX_AMI_USERNAME?: string;
  PBX_AMI_PASSWORD?: string;
  DEMO_MODE?: string;
  PUBLIC_DEMO_READONLY?: string;
  PUBLIC_DEMO_EDITOR_EMAILS?: string;
  MAX_UPLOAD_MB?: string;
  DEMO_MAX_FILES_PER_CASE?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_BACKUP_FOLDER_ID?: string;
  DATABASE_URL?: string;
  DATABASE_SSL?: string;
  POSTGRES_URL?: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE?: string;
  DOCUMENT_BUCKET_NAME?: string;
  BACKUP_BUCKET_NAME?: string;
  FORGEJO_BASE_URL?: string;
  FORGEJO_PUBLIC_URL?: string;
  FORGEJO_API_TOKEN?: string;
  FORGEJO_OWNER?: string;
  FORGEJO_SSH_HOST?: string;
  FORGEJO_SSH_PORT?: string;
  NEON_API_KEY?: string;
  NEON_PROJECT_ID?: string;
  NEON_BRANCH_ID?: string;
  NEON_BRANCH_NAME?: string;
}

declare global {
  type AppEnv = import("./env").AppEnv;
}
