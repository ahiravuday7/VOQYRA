import User from "./user.model.js";

import {
  USER_ROLES,
  USER_STATUSES,
} from "../../shared/constants/user.constants.js";

/*
| Find Registration Conflicts
*/

export const findRegistrationConflicts = ({ email, phone }) => {
  const conditions = [{ email }];

  if (phone) {
    conditions.push({ phone });
  }

  return User.find({
    $or: conditions,
  })
    .select("email phone")
    .lean();
};

/*
| Create Customer
*/

export const createCustomer = ({
  firstName,
  lastName,
  email,
  phone,
  password,
}) => {
  return User.create({
    firstName,
    lastName,
    email,
    phone,
    password,

    /*
     * Public registration can only create customers.
     */
    role: USER_ROLES.CUSTOMER,
    status: USER_STATUSES.ACTIVE,
  });
};
