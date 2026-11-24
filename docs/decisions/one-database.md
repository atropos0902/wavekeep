# One database

Jobs live in Postgres with the data, through pg-boss. A wave, its captures and their jobs are then created in one transaction, and there's no moment where a wave exists with half its jobs.

It stops being enough when answers arrive faster than one Postgres can write them along with their mentions and counts. Counting runs at about 4,000 answers a second on the test machine with one worker. A customer asking 500 questions on five engines with ten repeats, daily, is 25,000 answers a day, so that's a long way off. The first thing to move out would be the saved answer text.
