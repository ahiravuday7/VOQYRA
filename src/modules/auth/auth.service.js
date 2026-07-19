import AppError from "../../shared/errors/app-error.js";

import {
  createCustomer,
  findRegistrationConflicts,
} from "../users/user.repository.js";

/*
|--------------------------------------------------------------------------
| Register Customer
|--------------------------------------------------------------------------
*/

export const registerCustomer = async (registrationData) => {
  const { firstName, lastName, email, phone, password } = registrationData;

  const conflicts = await findRegistrationConflicts({
    email,
    phone,
  });

  const emailAlreadyExists = conflicts.some((user) => {
    return user.email === email;
  });

  if (emailAlreadyExists) {
    throw new AppError(
      "An account with this email address already exists",
      409,
      {
        errorCode: "EMAIL_ALREADY_REGISTERED",
      },
    );
  }

  const phoneAlreadyExists =
    phone &&
    conflicts.some((user) => {
      return user.phone === phone;
    });

  if (phoneAlreadyExists) {
    throw new AppError(
      "An account with this phone number already exists",
      409,
      {
        errorCode: "PHONE_ALREADY_REGISTERED",
      },
    );
  }

  const user = await createCustomer({
    firstName,
    lastName,
    email,
    phone,
    password,
  });

  return user;
};
