[kenken.gg](https://kenken.gg/)
===============================

*The laziest KenKen solver online!*

### About this repository

Contains two applications:

1. web: A React SPA built with Vite. The KenKen solver runs entirely in the browser
   in a Web Worker, so puzzles are solved without a network call. Deployed to Netlify
   as a static site.
2. api: The original Scala KenKen solver, deployed as an API using the
   [Serverless](https://serverless.com/) framework. It is kept for reference and
   parity testing while the client-side solver ships; it is no longer called by the
   web app.

### Development

Everything the web app needs is in `web/`; there is no backend to run.

```sh
cd web
npm install        # or: npm ci, for an exact lockfile install
npm run dev        # http://localhost:5173, with hot reload
```

Tests and the type checker:

```sh
cd web
npm test           # vitest: solver unit tests + parity against the Scala solver
npm run typecheck  # tsc --noEmit
```

The parity fixtures in `web/src/solver/__fixtures__/` are recorded output from the
Scala solver, and `web/src/solver/README.md` documents where they came from. They are
what keeps the TypeScript port honest, so a parity failure is a real regression rather
than a fixture that needs refreshing.

### Build

```sh
cd web
npm run build      # static files land in web/dist/
npm run preview    # serve web/dist/ locally at http://localhost:4173
```

The build is fully static: `web/dist/` can be served by any file server.

### Deploy

Hosting is [Netlify](https://www.netlify.com/), configured by
[`netlify.toml`](netlify.toml) at the repo root. The repo is the source of truth for
the build — change `netlify.toml`, not the Netlify UI.

- **Production:** every push to `master` builds and publishes to
  <https://kenken-gg.netlify.app>.
- **Deploy previews:** every pull request gets its own preview URL, posted as a check
  on the PR. Use them to look at a change without merging it.
- **Build:** `npm ci && npm run build` inside `web/`, publishing `web/dist`, on Node 20.

To reproduce a Netlify build by hand, run exactly that: `cd web && npm ci && npm run
build`. Better still, run `netlify build`, which reads `netlify.toml` and executes the
same command in the same directory Netlify would. A build that passes locally but fails
on Netlify is almost always a Node version difference — `netlify.toml` pins
`NODE_VERSION` to the same major as `.github/workflows/test.yaml`, so keep those two in
step and check them first.

`netlify build` resolves the git root, so run it from a normal checkout rather than
from a `git worktree` whose sibling checkout may be on a different commit.

### Rolling back

Netlify keeps every deploy. To roll back, open the site's **Deploys** page in the
Netlify UI and publish the last good one; it takes effect immediately and needs no
commit. To move forward again, push to `master` (or press **Trigger deploy** on the
latest deploy).

The git-level alternative is a `git revert` of the offending commit on `master`, which
triggers a fresh production deploy of the reverted tree. Prefer the Deploys page when
the site is broken right now: it is faster and it does not put a revert commit in the
history of a revert.

### Domain

`kenken.gg` is the site's custom domain. It is registered with **Gandi**, and DNS has to
delegate it to Netlify for the domain to serve this site.

The Netlify site is always reachable at <https://kenken-gg.netlify.app>, which needs no
DNS work at all, so that URL is the fallback whenever the domain is misbehaving. Custom
domains and their certificates are listed under the site's **Domain management** in the
Netlify UI; HTTPS certificates are issued by Netlify and renew automatically once DNS
points at the site.

### Reporting issues

If you find something that isn't working as you might expect, please open a GitHub issue.

### Legal notice

- KenKen is a trademark of [Nextoy LLC](https://www.nextoy.com/). Neither boxysean nor kenken.gg claims no ownership over the KenKen trademark.
- kenken.gg is unaffiliated with Nextoy LLC and is not endorsed by Nextoy LLC.
- kenken.gg is a free service and does not generate revenue.
