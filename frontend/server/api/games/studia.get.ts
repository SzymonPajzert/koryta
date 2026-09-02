import { authCachedEventHandler } from "~~/server/utils/handlers";
import { gameDateValidator, warsawToday } from "~~/server/utils/games";
import { dailyStudiaTarget } from "~~/server/utils/studia";
import { puzzleNumber } from "~~/shared/games/engine";
import { gameEntry } from "~~/shared/games/registry";
import { educationVocabulary } from "~~/shared/games/educationVocabulary";
import { studiaSlug, type StudiaPuzzle } from "~~/shared/games/studia";

/** Today's anonymous CV.
 *
 * Everything the player is allowed to see and nothing else: the career with
 * its employers reduced to branże, the terms they may answer with, and how
 * many there are so a rank can be read as a fraction. The answer is not here -
 * see `/api/games/studia/guess`.
 */
export default authCachedEventHandler(async (event) => {
  const { date } = await getValidatedQuery(event, (query) =>
    gameDateValidator.parse(query),
  );
  const day = date ?? warsawToday();

  const target = await dailyStudiaTarget(day);
  if (!target) {
    // Not a failure of the request. Almost nobody in the register has their
    // education filled in, so on most days there is simply nobody to ask
    // about; the page says so rather than showing a broken board.
    throw createError({
      statusCode: 503,
      statusMessage: "Brak osoby z uzupełnionym wykształceniem na ten dzień",
    });
  }

  const puzzle: StudiaPuzzle = {
    date: day,
    number: puzzleNumber(gameEntry(studiaSlug).firstDay, day),
    cv: target.cv,
    terms: educationVocabulary
      .map((entry) => entry.term)
      .sort((a, b) => a.localeCompare(b, "pl")),
    vocabularySize: educationVocabulary.length,
  };
  return puzzle;
});
