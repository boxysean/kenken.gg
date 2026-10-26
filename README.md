[kenken.gg](https://kenken.gg/)
===============================

*The laziest KenKen solver online!*

### About this repository

Contains two applications:

1. web: A React SPA built with Vite. The KenKen solver runs entirely in the browser
   in a Web Worker, so puzzles are solved without a network call. Deployed to AWS
   and served over Cloudfront.
2. api: The original Scala KenKen solver, deployed as an API using the
   [Serverless](https://serverless.com/) framework. It is kept for reference and
   parity testing while the client-side solver ships; it is no longer called by the
   web app.

They are deployed using GitHub Actions.

### Reporting issues

If you find something that isn't working as you might expect, please open a GitHub issue.

### Legal notice

- KenKen is a trademark of [Nextoy LLC](https://www.nextoy.com/). Neither boxysean nor kenken.gg claims no ownership over the KenKen trademark.
- kenken.gg is unaffiliated with Nextoy LLC and is not endorsed by Nextoy LLC.
- kenken.gg is a free service and does not generate revenue.
