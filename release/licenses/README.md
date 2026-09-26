# Third-party notices

Every frontend and self-host build writes `THIRD_PARTY_NOTICES.txt` and `THIRD_PARTY_COMPONENTS.json` into `dist/` and `dist-server/`, respectively. The Docker runtime copies both directories, including these files. The browser notice is available at `/THIRD_PARTY_NOTICES.txt` when the built frontend is served.

The collector uses rendered Vite chunks and esbuild output contributions to identify npm packages whose JavaScript is distributed. It also attributes known injected Vite/Vue/CommonJS helpers to the packages that contain their original notices. Each report records installed package identity, locked version and integrity, the SHA-256 of `package-lock.json`, and unmodified root LICENSE/COPYING/NOTICE texts with individual hashes. Missing texts, changed identities, symlinked inputs and unmapped virtual modules fail the build. Dependency and bundler upgrades therefore need a fresh build and review of the resulting reports.

All supplied license alternatives are retained; this collection does not select alternatives or replace a compatibility review. It covers the JavaScript graph, not every source dependency, generated CSS, images, fonts, Docker operating-system packages or embedded upstream components. Vite's supplied LICENSE contains additional upstream notices. Review container and asset attribution separately before a release. These reports do not license Personal Archive itself.

## Postgres.js fallback

The installed `postgres@3.4.9` npm package omits a root license file. `postgres-3.4.9.UNLICENSE` is the unmodified text from the [upstream v3.4.9 UNLICENSE](https://github.com/porsager/postgres/blob/v3.4.9/UNLICENSE), retrieved on 2026-09-06.

SHA-256: `b5065838cbac452dfc855ba6e6e031481ad2c68406f70d21ead9321374653e6c`.

The collector accepts this fallback only for that exact package/version and hash. A version change must have its own reviewed attribution; do not change the expected hash merely to bypass a build failure.
