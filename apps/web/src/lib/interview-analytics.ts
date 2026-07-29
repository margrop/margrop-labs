import {
  classifyLabDevice,
  emitLabAnalyticsEvent,
  labAnalyticsEndpointPaths,
  type InterviewAnalyticsEventName,
  type LabAnalyticsDeviceCategory,
  type LabAnalyticsEventSink,
} from "./lab-analytics";

export const interviewAnalyticsEndpointPath =
  labAnalyticsEndpointPaths["interview-workbench"];
export const classifyInterviewDevice = classifyLabDevice;

export const emitInterviewAnalyticsEvent = (
  eventName: InterviewAnalyticsEventName,
  deviceCategory: LabAnalyticsDeviceCategory,
  sink?: LabAnalyticsEventSink,
) =>
  emitLabAnalyticsEvent("interview-workbench", eventName, deviceCategory, sink);
