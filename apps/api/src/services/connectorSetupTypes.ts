/**
 * The shape of a connector's setup plan.
 *
 * Kept in its own file so the plan data (which is long, and edited often) does not have to be read to
 * find out what a plan is, and so the type can be imported by the probe without pulling in the plans
 * themselves.
 */

export interface SetupPrerequisite {
  title: string;
  detail: string;
  /** The vendor's own documentation for this step, when the vendor has a page for it. */
  link?: string;
}

export interface SetupGroup {
  title: string;
  note: string;
  /**
   * Credential keys from the connector's catalogue entry, in the order to collect them.
   *
   * Groups exist because credentials come from different places: a tenant id from one screen and an
   * API key from another. Presenting them as one undifferentiated list is how somebody fills the API
   * key with the tenant id.
   */
  fields: string[];
}

export interface ConnectorSetup {
  /** What the connection is for, and what it deliberately will not do. */
  overview: string;
  /** What has to exist in the vendor's product before the first field is typed. */
  prerequisites: SetupPrerequisite[];
  /** The credentials, grouped by where they come from. */
  credentialGroups: SetupGroup[];
  /** What the settings step decides, when the connector has settings. */
  settingsNote?: string;
  /** What pressing Sync now will bring in, and what to expect from it. */
  firstSync: { title: string; detail: string };
  /** What is worth doing once it is running. */
  nextSteps: string[];
}

/** How much of a plan is enough to be worth showing: the probe holds plans to this. */
export const SETUP_MINIMUMS = {
  overview: 120,
  prerequisites: 2,
  groups: 1,
  firstSyncDetail: 80,
  nextSteps: 1,
} as const;
