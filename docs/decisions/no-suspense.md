# No Suspense boundary around a screen

On Next 16.2.4 a screen whose body sat inside a Suspense boundary sometimes fetched a refresh and didn't show it. It happened with a bare `router.refresh()` too, so the forms weren't the cause. Over repeated tries on the reports screen about one refresh in four was lost. Taking the boundary away, it worked every time, 120 saves out of 120.

The cost is that a screen arrives whole instead of in parts. The slowest one is under a quarter of a second cold. The tab that was pressed shows a mark while it loads, and the old screen stays up.

Cache Components mode wants a boundary around every dynamic body, so it's off and `"use cache"` is switched on by itself. Try again on a later Next version, with `e2e/refresh.spec.ts`.
