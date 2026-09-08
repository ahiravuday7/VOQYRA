import { v2 as cloudinary } from "cloudinary";

import env from "./environment.js";

/*
|--------------------------------------------------------------------------
| Cloudinary Configuration
|--------------------------------------------------------------------------
|
| Cloudinary credentials are loaded from validated environment variables.
|
| Never hardcode:
|
| - cloud name
| - API key
| - API secret
|
*/

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,

  api_key: env.CLOUDINARY_API_KEY,

  api_secret: env.CLOUDINARY_API_SECRET,

  secure: true,
});

export default cloudinary;
