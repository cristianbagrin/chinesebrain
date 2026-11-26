-- Chinese Brain Plus: the habit (src/cbp/push.ts). One row a day as the board reported it (reviews, cleared, essay,
-- cards, test, low = the lower bar after a miss, done), merged from every device; and the phones that asked for the
-- evening nudge (Web Push subscriptions).
CREATE TABLE IF NOT EXISTS habit (day TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0);
