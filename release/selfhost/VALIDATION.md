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

Garage was an independent test service, not added to the installation Compose file or chosen as a bundled production backend. Its tested image digest was `sha256:866bd13ed2038ba7e7190e840482bc27234c4afaf77be8cfa439ae088c1e4690`.

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

An inventory of 88 runtime Debian packages and the locations of their copyright/license files was collected. That inventory is not a complete image license or vulnerability review. Project and asset licensing, publication review, and the public repository/security-reporting destination remain pending. No release image has been published.
