/**
 * Factory for creating simulators based on scene configuration.
 */

import { validateScene, type Scene } from "./models";
import { Simulator, type SimulatorConfig } from "./simulator";
import type { SimulatorInterface } from "./simulatorInterface";
import { BrowserUseSimulator, type BrowserUseSimulatorOptions } from "../simulators/browserUseSimulator";

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
  validateScene(scene);
  const sceneSimConfig = scene.simulator;

  if (!sceneSimConfig || sceneSimConfig.type === "llm") {
    return new Simulator(scene, {
      ...options.defaultSimulatorConfig,
      model: sceneSimConfig?.model ?? options.defaultSimulatorConfig?.model,
    });
  }

  if (sceneSimConfig.type === "browser-use") {
    const browserOptions = sceneSimConfig.options as BrowserUseSimulatorOptions | undefined;
    return new BrowserUseSimulator(
      scene,
      {
        ...browserOptions,
        model: sceneSimConfig.model ?? browserOptions?.model ?? options.defaultSimulatorConfig?.model,
        baseURL: browserOptions?.baseURL ?? options.defaultSimulatorConfig?.baseURL,
        apiKey: browserOptions?.apiKey ?? options.defaultSimulatorConfig?.apiKey,
      },
    );
  }

  throw new Error(`Unknown simulator type: ${sceneSimConfig.type}`);
}
