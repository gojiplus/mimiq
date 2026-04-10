/**
 * Factory for creating simulators based on scene configuration.
 */

import type { Scene } from "./models";
import { Simulator, type SimulatorConfig } from "./simulator";
import type { SimulatorInterface, SimulatorConfig as SceneSimulatorConfig } from "./simulatorInterface";

export interface SimulatorFactoryOptions {
  defaultSimulatorConfig?: SimulatorConfig;
}

/**
 * Create a simulator based on scene configuration.
 * Falls back to LLM simulator if no simulator type specified.
 */
export function createSimulator(
  scene: Scene,
  options: SimulatorFactoryOptions = {},
): SimulatorInterface {
  const sceneSimConfig = (scene as Scene & { simulator?: SceneSimulatorConfig }).simulator;

  if (!sceneSimConfig || sceneSimConfig.type === "llm") {
    return new Simulator(scene, options.defaultSimulatorConfig);
  }

  if (sceneSimConfig.type === "stagehand") {
    // Dynamic import to handle optional dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { StagehandSimulator } = require("../simulators/stagehandSimulator");
    return new StagehandSimulator(scene, sceneSimConfig.options);
  }

  if (sceneSimConfig.type === "browser-use") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserUseSimulator } = require("../simulators/browserUseSimulator");
    return new BrowserUseSimulator(scene, sceneSimConfig.options);
  }

  throw new Error(`Unknown simulator type: ${sceneSimConfig.type}`);
}
