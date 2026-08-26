--> `missing_item_count` used to be typed into the work form and was never
--> decremented when anything arrived. It is now derived from the open rows in
--> `work_dependencies`, and no work item has any yet — so every existing figure
--> is a claim about outstanding items that no record supports.
-->
--> Zeroing them is the honest reading: the firm has not recorded what any of
--> this work waits on. The numbers were not reliable before and cannot be
--> recovered, and leaving them would show "18 outstanding" beside an empty list.
UPDATE "work_items" SET "missing_item_count" = 0;--> statement-breakpoint
--> Work sitting in `waiting` now claims at least one named, chaseable thing is
--> outstanding. Nothing does yet, so that status is unsupported. `at_risk` is
--> what the row means with the note it still carries: somebody is on it, and it
--> is not comfortable.
UPDATE "work_items" SET "status" = 'at_risk' WHERE "status" = 'waiting';
