import request from "supertest";

import app from "../../src/app.js";

import User from "../../src/modules/users/user.model.js";

import {
  USER_ROLES,
  USER_STATUSES,
} from "../../src/shared/constants/user.constants.js";

let userSequence = 0;

/*
|--------------------------------------------------------------------------
| Create Authenticated Test Agent
|--------------------------------------------------------------------------
|
| Creates a user, logs in through the real API and
| returns a Supertest agent containing auth cookies.
|--------------------------------------------------------------------------
*/

export const createAuthenticatedAgent = async (options = {}) => {
  const { role = USER_ROLES.ADMIN, email = null } = options;

  userSequence += 1;

  const resolvedEmail =
    email ?? `integration-${role}-${userSequence}@example.com`;

  const password = "Testing@123";

  const user = await User.create({
    firstName: role === USER_ROLES.ADMIN ? "Integration" : "Test",

    lastName: role === USER_ROLES.ADMIN ? "Admin" : "Customer",

    email: resolvedEmail,
    password,

    role,
    status: USER_STATUSES.ACTIVE,

    isEmailVerified: true,
    emailVerifiedAt: new Date(),
  });

  const agent = request.agent(app);

  const loginResponse = await agent
    .post("/api/v1/auth/login")
    .send({
      email: resolvedEmail,
      password,
    })
    .expect(200);

  return {
    agent,
    user,
    password,
    loginResponse,
  };
};
