import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";

import { AgentGatewayOperationRepositoryLive } from "./agentGateway/Layers/AgentGatewayOperationRepository";
import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { StudioOutputReactorLive } from "./orchestration/Layers/StudioOutputReactor";
import { ThreadGitMetadataReactorLive } from "./orchestration/Layers/ThreadGitMetadataReactor";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus";
import { ThreadDeletionReactorLive } from "./orchestration/Layers/ThreadDeletionReactor";
import { TurnCheckpointCoordinatorLive } from "./orchestration/Layers/TurnCheckpointCoordinator";
import { OrchestrationLayerLive } from "./orchestration/runtimeLayer";

import { DevServerManagerLive } from "./devServerManager";
import { DeviceServiceLive } from "./device/Layers/DeviceService";
import type { DeviceService } from "./device/Services/DeviceService";
import { KeybindingsLive } from "./keybindings";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitLayerLive, TextGenerationLayerLive } from "./git/runtimeLayer";
import { TerminalLayerLive } from "./terminal/runtimeLayer";
import { AuthControlPlaneLive } from "./auth/Layers/AuthControlPlane";
import { BootstrapCredentialServiceLive } from "./auth/Layers/BootstrapCredentialService";
import { ServerAuthLive } from "./auth/Layers/ServerAuth";
import { ServerAuthPolicyLive } from "./auth/Layers/ServerAuthPolicy";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore";
import { SessionCredentialServiceLive } from "./auth/Layers/SessionCredentialService";
import { ProfileStatsQueryLive } from "./profileStats";
import { ProfileStatsArchiveLive } from "./profileStatsArchive";
import { ServerLifecycleEventsLive } from "./serverLifecycleEvents";
import { ServerRuntimeStartupLive } from "./serverRuntimeStartup";
import { ServerSettingsLive } from "./serverSettings";
import { WorkspaceLayerLive } from "./workspace/runtimeLayer";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver";
import { ServerEnvironmentLive } from "./environment/Layers/ServerEnvironment";
import { ThreadDiagnosticsQueryLive } from "./diagnostics/Layers/ThreadDiagnosticsQuery";
import { ProjectPullRequestPinsLive } from "./persistence/Layers/ProjectPullRequestPins";
import { ProjectionTurnRepositoryLive } from "./persistence/Layers/ProjectionTurns";
import { OrchestrationEventDeliveryRepositoryLive } from "./persistence/Layers/OrchestrationEventDeliveries";
import { ManagedAttachmentCleanupLive } from "./managedAttachmentCleanup";
import { PullRequestServiceLive } from "./pullRequests/Layers/PullRequestService";
import { CodexProviderHealthLive } from "./provider/Layers/CodexProviderHealth";
import { makeServerProviderLayer } from "./provider/runtimeLayer";

export { makeServerProviderLayer } from "./provider/runtimeLayer";

export function provideThreadDeletionReactorDeviceService<
  ReactorServices,
  ReactorError,
  ReactorRequirements,
  DeviceError,
  DeviceRequirements,
>(
  reactorLayer: Layer.Layer<ReactorServices, ReactorError, ReactorRequirements>,
  deviceServiceLayer: Layer.Layer<DeviceService, DeviceError, DeviceRequirements>,
) {
  return reactorLayer.pipe(Layer.provideMerge(deviceServiceLayer));
}

export function makeServerRuntimeServicesLayer() {
  const providerHealthLayer = CodexProviderHealthLive.pipe(Layer.provideMerge(ServerSettingsLive));
  const checkpointStoreLayer = CheckpointStoreLive.pipe(Layer.provide(GitCoreLive));

  const checkpointDiffQueryLayer = CheckpointDiffQueryLive.pipe(
    Layer.provideMerge(OrchestrationLayerLive),
    Layer.provideMerge(checkpointStoreLayer),
  );

  const runtimeServicesLayer = Layer.mergeAll(
    OrchestrationLayerLive,
    checkpointStoreLayer,
    checkpointDiffQueryLayer,
    RuntimeReceiptBusLive,
    TurnCheckpointCoordinatorLive,
  );
  const managedAttachmentCleanupLayer = ManagedAttachmentCleanupLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const studioOutputReactorLayer = StudioOutputReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const threadGitMetadataReactorLayer = ThreadGitMetadataReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(GitLayerLive),
  );
  const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(OrchestrationEventDeliveryRepositoryLive),
    Layer.provideMerge(studioOutputReactorLayer),
    Layer.provideMerge(GitCoreLive),
    Layer.provideMerge(TextGenerationLayerLive),
    Layer.provideMerge(ServerSettingsLive),
    Layer.provideMerge(AgentGatewayOperationRepositoryLive),
  );
  const checkpointReactorLayer = CheckpointReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const profileStatsArchiveLayer = ProfileStatsArchiveLive.pipe(
    Layer.provideMerge(checkpointStoreLayer),
  );
  const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
    Layer.provideMerge(runtimeIngestionLayer),
    Layer.provideMerge(providerCommandReactorLayer),
    Layer.provideMerge(checkpointReactorLayer),
    Layer.provideMerge(studioOutputReactorLayer),
    Layer.provideMerge(threadGitMetadataReactorLayer),
  );
  const threadDeletionReactorLayer = provideThreadDeletionReactorDeviceService(
    ThreadDeletionReactorLive.pipe(
      Layer.provideMerge(profileStatsArchiveLayer),
      Layer.provideMerge(OrchestrationLayerLive),
      Layer.provideMerge(TerminalLayerLive),
      Layer.provideMerge(GitCoreLive),
    ),
    DeviceServiceLive,
  );
  // Shares the single memoized TerminalManager with the top-level TerminalLayerLive.
  const devServerManagerLayer = DevServerManagerLive.pipe(Layer.provide(TerminalLayerLive));
  const sessionCredentialLayer = SessionCredentialServiceLive.pipe(
    Layer.provide(ServerSecretStoreLive),
  );
  const authControlPlaneLayer = AuthControlPlaneLive.pipe(
    Layer.provide(BootstrapCredentialServiceLive),
    Layer.provide(sessionCredentialLayer),
  );
  const serverAuthLayer = ServerAuthLive.pipe(
    Layer.provide(ServerAuthPolicyLive),
    Layer.provide(BootstrapCredentialServiceLive),
    Layer.provide(sessionCredentialLayer),
    Layer.provide(authControlPlaneLayer),
  );
  const authServicesLayer = Layer.mergeAll(
    ServerAuthPolicyLive,
    ServerSecretStoreLive,
    BootstrapCredentialServiceLive,
    sessionCredentialLayer,
    authControlPlaneLayer,
    serverAuthLayer,
  );
  const pullRequestServiceLayer = PullRequestServiceLive.pipe(
    Layer.provideMerge(GitLayerLive),
    Layer.provideMerge(ProjectPullRequestPinsLive),
    Layer.provideMerge(OrchestrationLayerLive),
  );

  return Layer.mergeAll(
    managedAttachmentCleanupLayer,
    AgentGatewayOperationRepositoryLive,
    providerHealthLayer,
    ProjectPullRequestPinsLive,
    pullRequestServiceLayer,
    orchestrationReactorLayer,
    providerCommandReactorLayer,
    threadGitMetadataReactorLayer,
    threadDeletionReactorLayer,
    devServerManagerLayer,
    DeviceServiceLive,
    GitLayerLive,
    TextGenerationLayerLive,
    TerminalLayerLive,
    KeybindingsLive,
    ServerSettingsLive,
    ServerEnvironmentLive,
    ThreadDiagnosticsQueryLive,
    ProfileStatsQueryLive,
    authServicesLayer,
    ServerLifecycleEventsLive,
    ServerRuntimeStartupLive,
    WorkspaceLayerLive,
    ProjectFaviconResolverLive,
  ).pipe(Layer.provideMerge(NodeServices.layer));
}

export function makeServerApplicationLayers() {
  return {
    runtimeServicesLayer: makeServerRuntimeServicesLayer(),
    providerLayer: makeServerProviderLayer(),
  } as const;
}
