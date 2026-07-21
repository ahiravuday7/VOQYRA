import RefreshSession from "./refresh-session.model.js";

import { REFRESH_SESSION_REVOKE_REASONS } from "../../shared/constants/auth.constants.js";

/*
| Create Refresh Session
*/

export const createRefreshSession = async (sessionData, options = {}) => {
  const { session = null } = options;

  if (!session) {
    return RefreshSession.create(sessionData);
  }

  /*
   * Model.create() requires an array when
   * transaction options are supplied.
   */
  const [createdSession] = await RefreshSession.create([sessionData], {
    session,
  });

  return createdSession;
};

/*
| Find Refresh Session for Verification
*/

export const findRefreshSessionByTokenId = (tokenId, options = {}) => {
  const { session = null } = options;

  const query = RefreshSession.findOne({
    tokenId,
  }).select("+tokenHash");

  if (session) {
    query.session(session);
  }

  return query;
};

/*
| Atomically Rotate Active Session
*/

export const rotateActiveRefreshSession = (
  { sessionId, replacedByTokenId, lastUsedIp },
  options = {},
) => {
  const { session = null } = options;

  const now = new Date();

  return RefreshSession.findOneAndUpdate(
    {
      _id: sessionId,
      revokedAt: null,

      expiresAt: {
        $gt: now,
      },
    },
    {
      $set: {
        revokedAt: now,

        revokedReason: REFRESH_SESSION_REVOKE_REASONS.ROTATED,

        replacedByTokenId,
        lastUsedAt: now,
        lastUsedIp,
      },
    },
    {
      new: true,
      runValidators: true,
      session,
    },
  );
};

/*
| Revoke All Active User Sessions
|--------------------------------------------------------------------------
*/

export const revokeActiveRefreshSessionsForUser = (
  userId,
  reason,
  options = {},
) => {
  const { session = null } = options;

  return RefreshSession.updateMany(
    {
      user: userId,
      revokedAt: null,

      expiresAt: {
        $gt: new Date(),
      },
    },
    {
      $set: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    },
    {
      session,
    },
  );
};
