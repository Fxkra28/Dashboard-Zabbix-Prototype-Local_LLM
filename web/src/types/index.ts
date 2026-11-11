/**
 * The shapes of what the BFF answers, one file for each part of the portal. Everything is re-exported here, so a page imports from `../types`
 * and does not need to know which file holds a name.
 */

export type {
  Device,
  DeviceKind,
  DevicesResponse,
  Host,
  HostGroup,
  HostInterface,
  HostOverview,
  HostState,
  Item,
  LatestItem,
  LatestResponse,
  SiteRef,
  StateReason,
} from './hosts';

export type { AcknowledgeResult, Problem } from './problems';

export type { GraphPoint, GraphRange, GraphResponse, GraphSeries } from './graphs';

export type {
  IcmpState,
  Link,
  LinksResponse,
  LinkState,
  MapDetail,
  MapLink,
  MapSelement,
  NetDevice,
  NetInterface,
  NetInterfacesResponse,
  OperStatus,
  Site,
  SiteHost,
  SiteSource,
  SitesResponse,
  ZMap,
} from './network';

export type { Meter, MeterLevel, MeterLink, MeterOther, MetersResponse, MeterState, MeterZone } from './meters';

export type {
  Freshness,
  GroupProblems,
  Stats,
  TopHostRow,
  TopHostsMetric,
  TopHostsResponse,
  WebFailure,
  WebMonitoringResponse,
} from './dashboard';

export type {
  AgingReport,
  CapacityMetricKey,
  CapacityReport,
  CapacityRow,
  Dimension,
  DimensionKey,
  HostGap,
  NoiseFlag,
  NoiseReport,
  NoisyTrigger,
  ScorecardResponse,
  TopTrigger,
  TopTriggersReport,
} from './reports';

export type {
  AvailabilityBasis,
  AvailabilityReport,
  DataStatus,
  DerivedKind,
  DerivedServiceNode,
  DerivedServicesResponse,
  DeletedRecipients,
  EmailInfo,
  EmailRequest,
  EmailSent,
  ReportFileFormat,
  ReportStyle,
  SavedRecipients,
  ScheduleInfo,
  ScheduleRequest,
  ScheduleSettings,
  SendRecord,
  HostAvailability,
  ServiceNode,
  ServiceSla,
  ServicesResponse,
  Sla,
  SlaSli,
  SlaSource,
  SliGap,
  SliGroup,
  SliHost,
  SliPath,
  SliProfile,
  SliReport,
  SliWeb,
} from './sla';

export type { ChatContext, ChatDone, ChatMessage, ProblemExplanation, SlaExplanation } from './assistant';

export type { Health, Me, Role } from './auth';
