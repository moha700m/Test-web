CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`session` text NOT NULL,
	`origin` text NOT NULL,
	`url` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	`verified` integer DEFAULT 0 NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hosts` (
	`origin` text PRIMARY KEY NOT NULL,
	`verify_at` integer DEFAULT 0 NOT NULL,
	`last_started` integer DEFAULT 0 NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`run_id` text
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session` text NOT NULL,
	`origin` text NOT NULL,
	`started` integer NOT NULL,
	`stopped` integer DEFAULT 0 NOT NULL,
	`finished` integer DEFAULT 0 NOT NULL,
	`result` text
);
