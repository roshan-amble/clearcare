import { dateOf, localNow, type LocalDate, type LocalDateTime } from "@clearcare/domain";

/** Local wall-clock time of this machine, the household's time. */
export function clock(): { readonly now: LocalDateTime; readonly today: LocalDate } {
  const now = localNow(new Date());
  return { now, today: dateOf(now) };
}
