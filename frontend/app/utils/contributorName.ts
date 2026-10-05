import { mdiAccountCircle, mdiEyeOffOutline } from "@mdi/js";
import type { ActivityContributor } from "~~/server/api/stats/activity.get";

/** What a contributor's name needs to say about itself, wherever it is drawn:
 * the ranking's chip and the activity feed's line both take it from here, so
 * the two cannot give one person two different answers about their privacy. */
export type ContributorNameRow = Pick<
  ActivityContributor,
  "name" | "named" | "isSelf" | "photoURL" | "publicName"
>;

/** Whether everybody else sees this name. For your own row that is
 * `publicName`, not `named`: your name is shown to you whatever the setting,
 * and "visible to everyone" over a name the others see masked is a false
 * statement about your privacy. `named` stands in for a row sent without it. */
export function contributorShownToOthers(row: ContributorNameRow): boolean {
  return row.isSelf ? (row.publicName ?? row.named) : row.named;
}

export function contributorNameIcon(row: ContributorNameRow): string {
  return contributorShownToOthers(row) ? mdiAccountCircle : mdiEyeOffOutline;
}

/** The tooltip over a name. `identified` is a reader who is an administrator
 * and is shown every name whatever its owner chose - so "agreed to be shown"
 * would be a claim about somebody who may never have. */
export function contributorNameExplanation(
  row: ContributorNameRow,
  identified = false,
): string {
  if (row.isSelf) {
    return contributorShownToOthers(row)
      ? "To Ty. Twoja nazwa jest widoczna dla wszystkich."
      : "To Ty. Inni widzą w tym miejscu zamazaną nazwę — możesz to zmienić w swoim profilu.";
  }
  if (identified && row.named) {
    return "Widzisz tę nazwę jako administrator. Inni widzą ją tylko wtedy, gdy ta osoba włączyła to w profilu.";
  }
  return row.named
    ? "Ta osoba zgodziła się, żeby jej nazwa była widoczna publicznie."
    : "Ta osoba nie pokazuje swojej nazwy publicznie.";
}
