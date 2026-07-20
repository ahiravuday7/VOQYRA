import RefreshSession from "./refresh-session.model.js";

/*
| Create Refresh Session
*/

export const createRefreshSession = (sessionData) => {
  return RefreshSession.create(sessionData);
};
