# Live engines and the spending cap

**Who asked.** Whoever pays the bill.

**What they'll do with it.** See the number of captures and the cost before a wave starts, and know it stops at the cap.

**What's left out.** Guessing prices. A live engine without a price in its config is refused at startup, because the cap couldn't be kept.

**The check.** The cost of a call is reserved before the call is made. A wave at its cap fails the remaining captures with the reason, and they show up as missing on the overview.
