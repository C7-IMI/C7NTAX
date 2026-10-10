-- The instance tier is new, so every role that is already stored needs telling about it — and the
-- telling has to be selective, which is the whole point of the change.
--
-- Permissions are stored as an explicit list on `Role` (`permissions String[]`), and `computePermissions`
-- uses that list when it is non-empty. That is why a brand-new permission does not simply appear for
-- everybody who "had everything": no stored list contains it, so without this migration the roles that
-- are supposed to hold the tier (`super_admin`, `developer_admin`) would lose it, and the deployment
-- would be unable to change its own authentication policy at all.
--
-- Three cases, and only two of them are touched:
--
--   · `super_admin` and `developer_admin` — given all three. Both held every permission that existed
--     before this tier was introduced, so this preserves what they had rather than widening it.
--   · `admin` — deliberately **not** given them. This is the demotion the tier exists for: an
--     administrator may reset one person's second factor, but deciding that everybody must have one is
--     the operator's decision, not his. Leaving the list alone is what makes `computePermissions`
--     subtract the tier for that role.
--   · every other role (Manager, Technician, Client Admin, Read Only, and any custom role) — left alone.
--     They never held the instance switches, and the new keys were never in their lists to begin with.
--
-- `@>` is used for the guard so re-running is harmless, and `||` appends only the keys that are missing
-- so a role that somehow already has one of them is not given it twice.

-- AlterTable (data): the two roles that held everything keep holding everything.
UPDATE "Role"
SET "permissions" = "permissions" || ARRAY['instance:security', 'instance:config', 'instance:maintenance']
WHERE "systemRole" IN ('super_admin', 'developer_admin')
  AND NOT ("permissions" @> ARRAY['instance:security', 'instance:config', 'instance:maintenance']);

-- Belt and braces: append whichever of the three is individually missing, so a role that was left
-- partially migrated by an interrupted run still ends up complete.
UPDATE "Role"
SET "permissions" = "permissions" || (
  SELECT ARRAY(
    SELECT key FROM unnest(ARRAY['instance:security', 'instance:config', 'instance:maintenance']) AS key
    WHERE NOT ("Role"."permissions" @> ARRAY[key])
  )
)
WHERE "systemRole" IN ('super_admin', 'developer_admin')
  AND NOT ("permissions" @> ARRAY['instance:security', 'instance:config', 'instance:maintenance']);

-- The demotion, asserted rather than assumed. `admin` roles must not carry a tier permission; if one
-- does — because it was hand-edited on an instance where the keys already existed — it is removed here
-- rather than left to the editor to notice.
UPDATE "Role"
SET "permissions" = (
  SELECT ARRAY(
    SELECT key FROM unnest("Role"."permissions") AS key
    WHERE key NOT IN ('instance:security', 'instance:config', 'instance:maintenance')
  )
)
WHERE "systemRole" = 'admin'
  AND "permissions" && ARRAY['instance:security', 'instance:config', 'instance:maintenance'];
