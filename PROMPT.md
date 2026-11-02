Paste this into your Grok Bot once. It connects all your bots to a live 3D dashboard, with no server to run.
(The text has no links or hashtags on purpose, so it pastes cleanly into X. The bot builds the addresses itself in step 1.)

```
I'd like to set up a small status feed for all my bots, so I can watch them on a dashboard. It uses ntfy, a free notification service, over plain HTTPS with curl. Please do these steps in order.

1. Run this once. It prints three lines: remember the first as TOPIC, the second as FEED (the feed address) and the third as LINK (my dashboard). Use them in every step below:
python3 -c "import secrets,string;t='gbw-'+''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(22));print(t);print('https:'+'//'+'ntfy'+'.sh/'+t);print('office/'+chr(35)+t)"

2. Save the rule below in my shared user memory (the shared profile that all my bots see), with the real FEED address written in. Save it as three separate short facts, each under 400 characters, so none gets cut. If the shared memory already has an older rule about posting statuses to ntfy, delete it, or mark it as replaced by this one.
Fact A: On every status change (you start a task, finish it, need me, hit an error, go idle), run: curl -s -d '{"bot":"<your exact name>","status":"working|idle|waiting_user|error|done","step":"<what you are doing>"}' FEED
Fact B: For that status line: pick one status from the list, send valid JSON only, step at most 80 characters, no secrets or personal data in step. If your name has a quote or apostrophe, send the JSON through curl's stdin from a here-document.
Fact C: Once a day on your first run, and whenever you create, change or delete a routine, post your own routines (an empty list if none): curl -s -d '{"routines":{"bot":"<your exact name>","items":[{"name":"<routine>","schedule":"<when, in words>","next_run":"<ISO time>"}]}}' FEED

3. Post the roster: the exact name of every bot I have, including yourself:
curl -s -d '{"roster":["Bot A","Bot B"]}' FEED

4. Invent a look for each bot from its name and role.
shape is one of: sphere, rounded_cube, pill, triangle, cone, pentagon, hexagon, star4, star6, clover, rounded_square, trio.
accessory is one of: none, glasses, stem, antenna, bow.
color is a six-digit hex colour with a number sign in front (for example a blue like 2D84F5). Post one line (several lines in the same format if it would pass 4000 characters):
curl -s -d '{"looks":{"Bot A":{"shape":"sphere","color":"<hex colour>","accessory":"none"}}}' FEED

5. Sort my bots into 3 to 6 teams by their roles, with short English team names (each team gets its own floor on the dashboard). Put yourself and any helper or test bots into one team, for example Ops. Post them:
curl -s -d '{"groups":{"Bot A":"Content","Bot B":"Finance"}}' FEED

6. Post each bot's chat link, the app link with its id (grokbot, colon, two slashes, then app/v1/agent?id= and the id). Skip a bot if you don't know its id:
curl -s -d '{"chat":{"Bot A":"<chat link>"}}' FEED

7. Create two routines for yourself. The channel forgets messages after 12 hours, so (a few minutes off schedule is fine):
Every day around 08:00 my local time: post steps 3, 4, 5 and 6 again.
Around 09:00, 13:00, 17:00 and 21:00 my local time: run your usage check, asking for the full list of bots (not only the top ones), and post one line. total_used_pct is the overall weekly limit used, in percent (the shared number, not only Grok Bot's part). bots is each of my bots' share of the usage this week, in percent (whole numbers are fine); leave out bots under 1%, rows that are not one of my bots (deleted bots, group chats, other people's bots) and any field you don't know:
curl -s -d '{"type":"usage","total_used_pct":37,"resets_at":"<ISO time>","bots":{"Bot A":4.1}}' FEED

8. Post one test status line for yourself, your own routines line, and one usage line now (as in step 7), so the dashboard shows the limit right away.

9. Reply with LINK first. Say that LINK is a path on the site where I host this dashboard (the same site I copied this prompt from): open office/ and then the fragment, for example office/#TOPIC. Say that the topic works like a password, so I should not share it. Then, only if something did not work, add a short list of the problems. Reply in the language I usually write to you in. Do not post any other secret to the channel or in your reply.
```
