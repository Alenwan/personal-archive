# Install Personal Archive on one Linux host

This Alpha installer runs the application, PostgreSQL and a private Garage S3 object store on one Linux host. It creates two private object buckets, applies database migrations and asks you to create the first administrator. There is **no default username, password, demo account or public registration**.

The bundled Garage configuration is a single node with no storage redundancy. Use replaceable test files first. Before keeping important files, arrange an off-host backup of PostgreSQL, both Garage buckets, `.env` and the matching source version. The previous [external-S3 installation](#use-an-existing-s3-service) remains available.

## Requirements

- Linux with Docker Engine and Docker Compose v2.24 or later; your account must be allowed to use Docker.
- Enough free disk space for the database, original files and backups. The default maximum upload is 250 MB per file.
- An interactive terminal for the first administrator's hidden password prompt. The install script does not accept a password on the command line.

## Quick install

Clone the repository, then run the installer:

```sh
git clone https://github.com/Alenwan/personal-archive.git
sh personal-archive/release/selfhost/install.sh
```

The installer generates a private `release/selfhost/.env` once, builds the app, starts PostgreSQL and Garage, creates the two buckets, runs migrations, and asks for an administrator email, display name and password. It then checks `/readyz`. Re-running the command keeps the existing configuration, volumes and accounts; it does not rotate keys or reset passwords. If installation stops partway through, fix the reported cause and run it again.

On the Linux host, open `http://127.0.0.1:8080` (or your configured `APP_PORT`). By default the application port is bound to **loopback only**. To use it from another computer, set up your own HTTPS reverse proxy or an SSH tunnel; keep the database and Garage ports private. Browser encryption outside localhost needs a secure HTTPS context. This installer does not configure a public HTTPS endpoint.

After signing in, upload and download a replaceable test file, save a note and a chapter, then restart the app with `docker compose -f compose.yaml -f compose.local.yaml restart app` from `release/selfhost` and verify the data is still there. Vault and encrypted writing use separate passwords that you must preserve.

## Accounts

The first administrator is the email and password **you enter during installation**. No account is created from repository examples. The app currently has no invite-email or full in-app member-management flow; a server operator uses these commands from the cloned repository:

```sh
sh personal-archive/release/selfhost/accounts.sh list
sh personal-archive/release/selfhost/accounts.sh create --email person@example.org --name "Person"
sh personal-archive/release/selfhost/accounts.sh create --email reader@example.org --name "Reader" --role ReadOnly
sh personal-archive/release/selfhost/accounts.sh reset-password --email person@example.org
```

Run these paths from the directory where you cloned the repository, or use their absolute paths. `create` defaults to the `Staff` role; `--role` can be `Admin`, `Manager`, `Staff` or `ReadOnly`. Both account creation and password reset ask for a temporary password twice without echoing it. Share that password privately. The user must change it at first sign-in; a reset also revokes active sessions. For automation, the underlying `manage-users.mjs` supports `--password-stdin`; never place passwords in shell arguments or `.env`.

Ordinary Archive files, notes and unencrypted writing are shared within an instance, while Private vault is scoped to each account. Creating an account does not create a private copy of ordinary Archive data.

## Data, backups and upgrades

PostgreSQL and Garage use separate named Docker volumes; `.env` contains the database password, object-store access key and three application recovery keys. The random Compose project name in `.env` identifies the volumes. Do not replace `.env`, delete the volumes, use `docker compose down --volumes`, or run the installer against an old instance's data.

The in-app backup screen is not a full disaster-recovery backup. Stop application writes and take a consistent PostgreSQL dump **plus both complete object buckets**, checksums, `.env` and the matching source revision. Keep an encrypted copy off the server and test restoring into a separate empty instance. A database-only dump does not include uploaded file bytes. The [validation record](VALIDATION.md) now covers a fresh install and repeat run of this combined installer on isolated Linux/arm64, as well as an earlier bounded restore exercise. A full restore of the new combined path and other CPU platforms are not yet verified.

For updates, preserve the existing `.env` and volumes, back up and prove restore first, then rebuild, apply migrations and restart. New database schemas may not work with older code; returning to an old image alone is not a reliable rollback.

## Use an existing S3 service

The base `compose.yaml` still provides the application and PostgreSQL without bundled Garage. Prepare two separate empty private buckets and credentials with ListBucket, GetObject, PutObject and DeleteObject permissions. The endpoint must be reachable **from containers**, and remote endpoints should use valid HTTPS.

From `release/selfhost`, run `node configure.mjs` with Node 24, or use the pinned Node container shown below. This creates `.env` only if it does not already exist. Fill in `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `DOCUMENT_BUCKET_NAME` and `BACKUP_BUCKET_NAME` without exposing them in logs.

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/setup" -w /setup node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df node configure.mjs
docker compose config --quiet
docker compose build app
docker compose up -d postgres
docker compose run --rm app node dist-server/migrate.mjs
docker compose run --rm app node dist-server/init-admin.mjs --email owner@example.org --name "Archive Owner"
docker compose up -d app
curl --fail http://127.0.0.1:8080/readyz
```

Replace the example email with your own. `init-admin.mjs` asks for the password and refuses to overwrite an existing account. The `accounts.sh` commands above detect this external-S3 configuration and work without the local Compose overlay.

## Troubleshooting

- Installer cannot use Docker: start Docker and grant this Linux account Docker access. Do not run an unreviewed `curl | sh` pipeline.
- Garage does not initialize: check `docker compose -f compose.yaml -f compose.local.yaml ps` and the Garage logs. Keep `.env` and log secrets out of public issues.
- `/readyz` returns 503: check migration success, both buckets and object-store permissions. `/healthz` only checks process liveness.
- Lost a login password: use `accounts.sh reset-password`. This does not recover separate Vault or encrypted-writing passwords.
- Single-node Garage cannot survive loss of its host or disk. Move the complete backup set off-host; it does not add redundancy by itself.

Image versions and notices are recorded in the Dockerfile and [license notes](../licenses/README.md). This is an Alpha source build, not a prebuilt image for every CPU architecture.
