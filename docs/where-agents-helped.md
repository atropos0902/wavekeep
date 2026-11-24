# Where a coding agent helped, and where a check caught it

| What | What caught it |
| --- | --- |
| Shared report page opened the database while the page was being prerendered | The build failed on a machine without a database |
| Routes for another workspace's questions and reports answered 200 with an empty list | The route walk over the OpenAPI document, which wants 404 |
| A close that failed on an untyped parameter | The first test that closed a wave |
| Version 2 of the mention detector looked fine on its own unit tests | The labeled set |
| Overview cached without the previous wave in its key, so it could keep saying "first wave" after the earlier wave was counted | Reading the key out loud in review. No test caught it |
| Saving a report showed "Draft saved." and left the list as it was, about one time in four. The first two fixes hid it | A browser test that failed now and then, then one that repeats the save twenty times |
| A switch in `closeWave` that turned its own lock off, added for a benchmark | Mutation testing, which kept it alive |
| Replayed answers depended on random ids, so the demo showed different numbers on each machine | A browser test that expected a fixed percentage |
