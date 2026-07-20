/*
|--------------------------------------------------------------------------
| Duration Multipliers
|--------------------------------------------------------------------------
*/

const DURATION_MULTIPLIERS = Object.freeze({
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
});

/*
|--------------------------------------------------------------------------
| Convert Duration to Milliseconds
|--------------------------------------------------------------------------
|
| Examples:
|
| 15m → 900000
| 7d  → 604800000
|--------------------------------------------------------------------------
*/

export const durationToMilliseconds = (duration) => {
  if (typeof duration !== "string") {
    throw new TypeError("Duration must be a string");
  }

  const match = duration.match(/^(\d+)([smhd])$/);

  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = Number(match[1]);
  const unit = match[2];

  return value * DURATION_MULTIPLIERS[unit];
};
