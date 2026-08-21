// FILE: agentBrowserIpc.ts
// Purpose: Registers the trusted renderer bridge for agent-browser sessions.
// Layer: Desktop IPC adapter

import type { IpcMain, WebContents } from "electron";
import type {
  AgentBrowserAckFrameInput,
  AgentBrowserEvent,
  AgentBrowserNavigateInput,
  AgentBrowserSendInput,
  AgentBrowserStartInput,
  AgentBrowserTabInput,
  AgentBrowserThreadInput,
  AgentBrowserViewportInput,
} from "@synara/contracts";

import type { DesktopAgentBrowserManager } from "./agentBrowserManager";
import { AGENT_BROWSER_IPC_CHANNELS } from "./ipcChannels";

export function sendAgentBrowserEvent(
  webContents: WebContents | null | undefined,
  event: AgentBrowserEvent,
): void {
  webContents?.send(AGENT_BROWSER_IPC_CHANNELS.event, event);
}

export function registerAgentBrowserIpcHandlers(
  ipcMain: IpcMain,
  manager: DesktopAgentBrowserManager,
): void {
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.getState);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.getState, (_event, input: AgentBrowserThreadInput) =>
    manager.getState(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.start);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.start, (_event, input: AgentBrowserStartInput) =>
    manager.start(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.stop);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.stop, (_event, input: AgentBrowserThreadInput) =>
    manager.stop(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.suspendPreview);
  ipcMain.handle(
    AGENT_BROWSER_IPC_CHANNELS.suspendPreview,
    (_event, input: AgentBrowserThreadInput) => manager.suspendPreview(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.setViewport);
  ipcMain.handle(
    AGENT_BROWSER_IPC_CHANNELS.setViewport,
    (_event, input: AgentBrowserViewportInput) => manager.setViewport(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.navigate);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.navigate, (_event, input: AgentBrowserNavigateInput) =>
    manager.navigate(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.reload);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.reload, (_event, input: AgentBrowserThreadInput) =>
    manager.reload(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.goBack);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.goBack, (_event, input: AgentBrowserThreadInput) =>
    manager.goBack(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.goForward);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.goForward, (_event, input: AgentBrowserThreadInput) =>
    manager.goForward(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.newTab);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.newTab, (_event, input: AgentBrowserTabInput) =>
    manager.newTab(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.closeTab);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.closeTab, (_event, input: AgentBrowserTabInput) =>
    manager.closeTab(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.selectTab);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.selectTab, (_event, input: AgentBrowserTabInput) =>
    manager.selectTab(input),
  );
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.sendInput);
  ipcMain.handle(AGENT_BROWSER_IPC_CHANNELS.sendInput, (_event, input: AgentBrowserSendInput) => {
    manager.sendInput(input);
  });
  ipcMain.removeHandler(AGENT_BROWSER_IPC_CHANNELS.ackFrame);
  ipcMain.handle(
    AGENT_BROWSER_IPC_CHANNELS.ackFrame,
    (_event, input: AgentBrowserAckFrameInput) => {
      manager.ackFrame(input);
    },
  );
}
