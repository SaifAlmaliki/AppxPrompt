UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:sk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{20,})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:sk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{20,})';
--> statement-breakpoint
UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:(?:sk|rk)_(?:live_|test_)?[A-Za-z0-9]{20,})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:(?:sk|rk)_(?:live_|test_)?[A-Za-z0-9]{20,})';
--> statement-breakpoint
UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:GOCSPX-[A-Za-z0-9_-]{20,})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:GOCSPX-[A-Za-z0-9_-]{20,})';
--> statement-breakpoint
UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:AIza[0-9A-Za-z_-]{35})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:AIza[0-9A-Za-z_-]{35})';
--> statement-breakpoint
UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{30,})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{30,})';
--> statement-breakpoint
UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:github_pat_[A-Za-z0-9_]{40,})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:github_pat_[A-Za-z0-9_]{40,})';
--> statement-breakpoint
UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:xox[abposr]-[A-Za-z0-9-]{10,})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:xox[abposr]-[A-Za-z0-9-]{10,})';
--> statement-breakpoint
UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:AKIA[0-9A-Z]{16})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:AKIA[0-9A-Z]{16})';
--> statement-breakpoint
UPDATE "messages" SET "content" = regexp_replace("content", '(^|[^A-Za-z0-9_-])(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})', '\1[key removed and moved to the keys dialog]', 'g') WHERE "content" ~ '(^|[^A-Za-z0-9_-])(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})';
