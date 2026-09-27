# Alpha installation validation

Recorded on 2026-09-06 for the 0.1.0-alpha.0 source candidate. This is a bounded acceptance result, not a public-release approval or a guarantee for every platform.

## Environment

| Component | Tested configuration |
| --- | --- |
| Host for containers | Disposable Ubuntu 24.04 Linux VM, arm64 |
| Docker / Compose | Docker 29.1.3; Compose 2.40.3, Ubuntu package |
| Application build | Source Dockerfile and its context allowlist; Node 24.19.0; npm 12.0.2 |
| PostgreSQL | 16.13, image digest pinned in compose.yaml |
| Object storage | Garage 2.3.0, two private buckets, path-style S3 requests, region `garage` |
| Storage connection | HTTP within the isolated Docker network; no S3 port exposed to the host |
| Browser check | Chrome through a localhost tunnel to the restored instance |

Garage was an independent test service for this 2026-09-06 run. A later optional bundled Garage Compose overlay and interactive installer were added; their separate 2026-09-26 check is recorded below. The earlier tested image digest was `sha256:866bd13ed2038ba7e7190e840482bc27234c4afaf77be8cfa439ae088c1e4690`.

## Passed

- Build the image from the candidate's exported source with Docker, without private Git history, host dependencies, prebuilt application files or existing application configuration.
- Generate a private `.env`, migrate an empty database and create the first administrator through protected standard input. Repeating configuration preserves all keys; repeating administrator initialization is refused.
- Run the application as `node`, with a read-only application filesystem and writable temporary directory. Only the application port is bound to host loopback; PostgreSQL has no published port.
- Sign in; reject unauthenticated document requests; load the built frontend, assets and third-party notices. Upload a UTF-8 text file and a binary file larger than 1 MiB, then verify preview/download and exact sizes/SHA-256 values.
- Save and retrieve a Knowledge note and a manuscript chapter. Create an application backup containing actual S3 objects. Restart the application and verify the saved content again.
- Stop application writes and capture a native PostgreSQL dump, every object in both buckets, content metadata, checksums and matching recovery configuration. Restore into a second empty database volume and two empty buckets on a separate Garage data volume. All **64 table row counts**, **2 document objects** and **6 backup objects** match before application startup; restored login and content checks pass.
- In Chrome, sign in to the restored instance, read the restored text in the reader and display the restored manuscript chapter. The reader's full-screen mode is exited using Back to archive before using the main navigation.
- Reject anonymous S3 access and an invalid S3 signature. Stop Garage: `/readyz` returns 503 while `/healthz` stays 200. Detection took about 52 seconds because successful storage probes are cached for up to one minute. Restart Garage and verify readiness and saved content recover.

## Limits

Linux/amd64, other S3 providers, external HTTPS/proxy configurations, NAS-specific setups and production-data import were not exercised in this run. The browser pass covered login and reading, not every editor/upload interaction. Container restore used ordinary documents, a note and a chapter; encrypted Vault and encrypted-writing recovery retain their separate synthetic native-PostgreSQL regression coverage and were not repeated in this container run.

An inventory of 88 runtime Debian packages and the locations of their copyright/license files was collected. That inventory is not a complete image license or vulnerability review. The source repository was published later; no prebuilt release image has been published.

## Combined one-host installer, 2026-09-26

The new `install.sh` was run on a fresh, disposable Ubuntu 24.04 Linux/arm64 VM with Docker 29.1.3 and Compose 2.40.3. The test used a source copy without Git history, local dependencies or private configuration. The script generated a mode-0600 `.env`, built the app image, started PostgreSQL and the bundled Garage 2.3.0 service, created and granted access to both private buckets, applied all 54 migrations, prompted for a synthetic first administrator and reached `/readyz`. The synthetic administrator's login API returned HTTP 200.

`accounts.sh create --role ReadOnly` created a second synthetic account with a hidden temporary password; `accounts.sh list` showed both accounts and their roles, and that account's login API returned HTTP 200. Re-running `install.sh` applied zero migrations, kept the existing accounts and reached readiness again. The native disposable-PostgreSQL suite separately passed the new account CLI's create, duplicate-rejection and reset-password checks, including temporary-password verification and active-session revocation.

This run did not perform a full object upload, off-host backup/restore or upgrade using the combined installer. Those operations still need release-specific verification before making stronger recovery claims. Linux/amd64 and external HTTPS were not exercised.

## Bundled recovery commands, 2026-09-27

The [self-host recovery workflow](../../.github/workflows/selfhost-recovery.yml) [passed](https://github.com/Alenwan/personal-archive/actions/runs/36305983667) on a disposable GitHub-hosted Ubuntu 24.04/amd64 runner for PR #1 after the restore script was updated to wait for PostgreSQL readiness. Its `test-recovery.sh` exercise built the public app image, started PostgreSQL and bundled Garage, created a synthetic administrator, uploaded a document, saved a Knowledge note and manuscript chapter, and wrote an in-app backup manifest to the second bucket. It then made an age-recipient-encrypted backup, verified the archive, restored it into a separate empty Compose project and port, and confirmed login, both HTTP health endpoints, exact downloaded file bytes, note and chapter bodies, and identical backup manifest bytes. A populated checkout and a truncated encrypted archive were refused. The first workflow attempt exposed the missing PostgreSQL readiness wait during restoration; the corrected run passed.

This is a synthetic single-node Garage recovery test, not a production restore or an off-host transport test. The interactive passphrase mode, Vault encryption recovery, large data sets, non-default Garage versions, external S3 and the separate MinIO-based 8188/8288 layout were not exercised. Operators still need an encrypted off-host copy and periodic restoration drills with their own data.
