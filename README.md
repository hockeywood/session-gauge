# session-gauge

A band above the Claude Code prompt that shows how full the context window is, your 5-hour and weekly plan usage with reset times, a projected end-of-window figure, and roughly how many replies are left before the session should be compacted or restarted. A Compact button runs /compact when you press it. Type /gauge to hide or show the band.

Context colours: green under 60%, amber from 60% (compact at the next break), red from 80% (start a new session).

Display only. It reads your plan limits from Anthropic's usage service through your own Claude login, and it sends nothing anywhere else.

Ideas borrowed, with thanks, from anantraghunath/claude-code-usage-quota-mod (MIT): live limit reads at session open, the pace-blend forecast, and the Compact button.

## Install

At the prompt of a terminal session:

    /plugin install session-gauge --marketplace hockeywood/session-gauge

From a shell:

    claude plugin install session-gauge --marketplace hockeywood/session-gauge

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with hockeywood/session-gauge, then Add plugin.
