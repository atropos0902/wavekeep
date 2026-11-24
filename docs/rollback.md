# Going back

Code: redeploy the previous build. Migrations come in two steps, so the previous build still runs against the current schema. CI checks that with the `old-build-new-schema` job.

Numbers: a bad name set or detector is undone by publishing the earlier version again. It's already counted, so the switch is one transaction and takes effect at once. From the repo, `publish(ctx, project, names, detector)` in `packages/service/src/count.ts`.

A wave can't be undone. If one was started by mistake, close it early and start another. Its captures stay, marked failed with the reason.
