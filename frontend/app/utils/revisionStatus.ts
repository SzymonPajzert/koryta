import {
  mdiCheckDecagramOutline,
  mdiClockOutline,
  mdiCloseCircleOutline,
  mdiHistory,
} from "@mdi/js";
import type { RowTone } from "~/composables/rowTone";
import type { ProposalStatus } from "~~/shared/proposals";

/** The icon each proposal state is drawn with - on `ChipRevisionStatus`, and
 * alone at the start of a row in an entry's history, where it is the only
 * thing saying the state until the row is opened. Kept in one place so the
 * chip and the bare icon cannot come to disagree. */
export const revisionStatusIcons: Record<ProposalStatus, string> = {
  pending: mdiClockOutline,
  approved: mdiCheckDecagramOutline,
  superseded: mdiHistory,
  rejected: mdiCloseCircleOutline,
};

/** The tone of an `AdminExpandRow` for a revision in each state: the same
 * hues as `proposalStatusLabels`, named the way the row takes them. */
export const revisionStatusTones: Record<ProposalStatus, RowTone> = {
  pending: "warning",
  approved: "success",
  superseded: "neutral",
  rejected: "danger",
};
