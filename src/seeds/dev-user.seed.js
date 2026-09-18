import User from "../modules/users/user.model.js";

import {
  USER_ROLES,
  USER_STATUSES,
} from "../shared/constants/user.constants.js";

/*
|--------------------------------------------------------------------------
| Seed Development User
|--------------------------------------------------------------------------
|
| Idempotency key:
|
| email
|
| Existing users are reused instead of duplicated.
|
*/

const seedDevelopmentUser = async ({
  firstName,
  lastName,
  email,
  password,
  role,
}) => {
  const normalizedEmail = String(email).trim().toLowerCase();

  const existingUser = await User.findOne({
    email: normalizedEmail,
  });

  if (existingUser) {
    return existingUser;
  }

  const user = await User.create({
    firstName,
    lastName,

    email: normalizedEmail,
    password,

    role,
    status: USER_STATUSES.ACTIVE,

    isEmailVerified: true,
    emailVerifiedAt: new Date(),
  });

  return user;
};

/*
|--------------------------------------------------------------------------
| Seed Development Users
|--------------------------------------------------------------------------
|
| Credentials are supplied by the caller.
|
| Do not hardcode development passwords in source control.
|
*/

export const seedDevelopmentUsers = async ({
  adminEmail,
  adminPassword,
  customerEmail,
  customerPassword,
}) => {
  const admin = await seedDevelopmentUser({
    firstName: "Development",
    lastName: "Admin",

    email: adminEmail,
    password: adminPassword,

    role: USER_ROLES.ADMIN,
  });

  const customer = await seedDevelopmentUser({
    firstName: "Development",
    lastName: "Customer",

    email: customerEmail,
    password: customerPassword,

    role: USER_ROLES.CUSTOMER,
  });

  return {
    admin,
    customer,
  };
};
