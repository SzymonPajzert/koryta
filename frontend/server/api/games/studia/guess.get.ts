import { z } from "zod";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { warsawToday } from "~~/server/utils/games";
import { dailyStudiaTarget } from "~~/server/utils/studia";
import {
  educationIndex,
  educationKey,
  educationRank,
  educationTemperature,
} from "~~/shared/games/education";
import { educationVocabulary } from "~~/shared/games/educationVocabulary";
import type { StudiaGuessResult } from "~~/shared/games/studia";

/** Where one guess sits against today's answer.
 *
 * A request per guess, which is the price of the answer never being in the
 * browser. It is a cheap one: the handler is cached on its url, so the
 * hundredth player to try "prawo" on a given day is served from the cache, and
 * the set of distinct guesses across a day is bounded by the vocabulary.
 */
const queryValidator = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  term: z.string().trim().min(1).max(200),
});

export default authCachedEventHandler(async (event) => {
  const { date, term } = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );
  const day = date ?? warsawToday();

  const index = educationIndex(educationVocabulary);
  const guess = index.get(educationKey(term));
  if (!guess) {
    throw createError({
      statusCode: 404,
      statusMessage: "Nie znam tego kierunku",
    });
  }

  const target = await dailyStudiaTarget(day);
  if (!target) {
    throw createError({
      statusCode: 503,
      statusMessage: "Brak zagadki na ten dzień",
    });
  }

  const rank = educationRank(educationVocabulary, target.term, guess);
  const solved = guess.term === target.term.term;
  const result: StudiaGuessResult = {
    term: guess.term,
    rank,
    total: educationVocabulary.length,
    temperature: educationTemperature(rank, educationVocabulary.length),
    solved,
    // Named only once the day is won. Until then the CV is anonymous, and the
    // whole game rests on it staying that way.
    ...(solved
      ? { personName: target.personName, personId: target.personId }
      : {}),
  };
  return result;
});
