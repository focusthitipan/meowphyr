import log from "electron-log";
import { createLoggedTypedHandler } from "./base";
import { readSettings } from "../../main/settings";
import { audioContracts } from "../types/audio";
import type { TranscribeAudioParams } from "../types/audio";
import { transcribeWithDyadEngine } from "../utils/llm_engine_provider";

const logger = log.scope("pro_handlers");
const typedHandle = createLoggedTypedHandler(logger);

const dyadEngineUrl = process.env.DYAD_ENGINE_URL;

export function registerProHandlers() {
  typedHandle(
    audioContracts.transcribeAudio,
    async (_event, input: TranscribeAudioParams) => {
      const settings = readSettings();
      const apiKey = settings.providerSettings?.auto?.apiKey?.value;

      if (!apiKey) {
        throw new Error(
          "LLM Gateway API key is not configured.",
        );
      }

      const audioBuffer = Buffer.from(input.audioData);

      const text = await transcribeWithDyadEngine(
        audioBuffer,
        input.filename,
        input.requestId,
        {
          apiKey,
          baseURL: dyadEngineUrl ?? "https://engine.dyad.sh/v1",
          dyadOptions: {},
          settings,
        },
      );

      return { text };
    },
  );
}
