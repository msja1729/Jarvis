import type { AppDef } from '../../gateway/types.js';
import { GCAL_APP } from './definition.js';

export const OUTLOOK_CAL_APP: AppDef = {
  id: 'outlookcal',
  name: 'Outlook Calendar',
  description: 'See and schedule events in your Outlook / Microsoft 365 calendar.',
  kind: 'builtin',
  abilities: GCAL_APP.abilities.map((a) => ({ ...a })),
};
