/**
 * Sample Data State — tracks whether the sample dataset is disabled.
 *
 * When disabled:
 *  - Snapshot captures are skipped (the snapshot is locked until re-enabled).
 *  - The automatic snapshot-after-change process pauses.
 *
 * The flag lives as a marker file: apps/api/.sample-data-disabled
 * (its existence means "sample data is disabled").
 */

import * as fs from "fs";
import * as path from "path";

export const SAMPLE_DATA_FLAG = path.join(__dirname, "..", ".sample-data-disabled");

export function isSampleDataDisabled(): boolean {
  try {
    return fs.existsSync(SAMPLE_DATA_FLAG);
  } catch {
    return false;
  }
}

export function setSampleDataDisabled(disabled: boolean): void {
  if (disabled) {
    fs.writeFileSync(SAMPLE_DATA_FLAG, new Date().toISOString());
  } else if (fs.existsSync(SAMPLE_DATA_FLAG)) {
    fs.unlinkSync(SAMPLE_DATA_FLAG);
  }
}
