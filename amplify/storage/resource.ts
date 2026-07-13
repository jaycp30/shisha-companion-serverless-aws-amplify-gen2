import { defineStorage } from '@aws-amplify/backend';
import { getUploadUrl } from '../functions/get-upload-url/resource';
import { analyzeMenu } from '../functions/analyze-menu/resource';

// Private bucket for uploaded menu photos. No user/guest access — only our two
// Lambdas touch it: getUploadUrl signs a PUT, analyzeMenu reads the object back.
// Granting a function access here also injects the bucket name into that
// function's generated `env` (see the handlers).
export const storage = defineStorage({
  name: 'shishaMenuUploads',
  access: (allow) => ({
    'menu/*': [
      allow.resource(getUploadUrl).to(['write']),
      allow.resource(analyzeMenu).to(['read']),
    ],
  }),
});
