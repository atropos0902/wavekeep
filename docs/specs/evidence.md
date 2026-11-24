# Evidence drawer

**Who asked.** An agency analyst who had to defend a number in a client call and couldn't find the answers behind it.

**What they'll do with it.** Open any number, read the answers, and send the client one that shows the point.

**What's left out.** Editing answers, hiding answers, exporting the list. Hiding one would change what a number means without changing the number.

**The check.** The drawer counts saved answers with its own query and doesn't read the stored counts. If the two differ the drawer says so on screen. `bench/agree.ts` compares them over random filters, and `e2e/app.spec.ts` clicks every number on twelve versions of the overview.
