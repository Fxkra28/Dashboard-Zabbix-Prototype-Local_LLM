/**
 * The checks of what the BFF answers, one file for each part of the portal, built from the pieces in `shape.ts`. Everything a page or `api/`
 * reads is re-exported here, so it imports from `../guards` and does not need to know which file holds a name.
 */

export type { Guard } from './shape';

export { assertFits, noteMisfit, UnreadableAnswer, unreadableMessage } from './misfit';

export { devicesGuard, hostGroupListGuard, hostListGuard, hostOverviewGuard, itemListGuard, latestGuard } from './hosts';

export { problemListGuard } from './problems';

export { graphGuard } from './graphs';

export { linksGuard, mapDetailGuard, mapListGuard, netDevicesGuard, netInterfacesGuard, sitesGuard } from './network';

export { metersGuard } from './meters';

export { freshnessGuard, groupProblemsGuard, statsGuard, topHostsGuard, webMonitoringGuard } from './dashboard';

export { agingGuard, capacityGuard, noiseGuard, scorecardGuard, topTriggersGuard } from './reports';

export {
  availabilityGuard,
  derivedServicesGuard,
  deletedRecipientsGuard,
  emailInfoGuard,
  emailSentGuard,
  savedRecipientsGuard,
  scheduleInfoGuard,
  servicesGuard,
  slaListGuard,
  slaSliGuard,
  slaSourceGuard,
  sliGuard,
} from './sla';

export { problemExplanationGuard, slaExplanationGuard } from './assistant';

export { meGuard } from './auth';
