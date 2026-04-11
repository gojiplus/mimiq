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

  if (sceneSimConfig.type === "browser-use") {
    throw new Error(
      "browser-use simulator requires async initialization. Use createSimulatorAsync() instead."
    );
  }

  throw new Error(`Unknown simulator type: ${sceneSimConfig.type}`);
}
