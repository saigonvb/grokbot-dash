For people who set up the dashboard against ntfy.sh and now hit its daily limit. They paste the text below into Grok Bot. Replace YOUR-RELAY-HOST with a mailbox you run before pasting. Then open the dashboard as `office/#<topic>&ntfy=https://YOUR-RELAY-HOST`. This page reads only the server named there.

```
Please move my bots' status feed to a new address, keeping my topic: run python3 -c "print('https:'+'//'+'YOUR-RELAY-HOST/')" and call its output NEW, then in my shared user memory and in your own routines, change every curl address that posts to my ntfy feed so it posts to NEW followed by the same topic, leave everything else as it is, and post one test status line for yourself to the new address. Reply with one short sentence when it is done.
```
