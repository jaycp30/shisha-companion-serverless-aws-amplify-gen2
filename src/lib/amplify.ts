import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import outputs from '../../amplify_outputs.json';

// Configure Amplify once, at module load, with the deployed backend's outputs.
Amplify.configure(outputs);

// Typed data client. client.queries.* / client.mutations.* carry the argument
// and return types inferred from amplify/data/resource.ts — no manual API typing.
export const client = generateClient<Schema>();
