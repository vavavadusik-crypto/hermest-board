// Проводка правок доски: выбор текст-модели и проверка её доступности. Вся
// логика операций и вся валидация — в domain/board-commands.js.

import { applyBoardRequest } from "../domain/board-commands.js";
import { describeBridgeAvailability } from "../media/text-model.js";

import { createDraftTextModel } from "./draft-service.js";

export async function boardCommandService({
  board,
  request,
  model,
  endpoint,
  signal,
  textModel,
  availabilityCheck = null
} = {}) {
  if (endpoint?.kind !== "openai" && endpoint?.kind !== "cli") {
    const availability = await (availabilityCheck || describeBridgeAvailability)();
    if (availability?.status !== "executable") {
      const reason = availability?.reason || "text model bridge is not available";
      throw Object.assign(new Error(reason), { statusCode: 503 });
    }
  }
  return applyBoardRequest({
    board,
    request,
    textModel: textModel || createDraftTextModel({ endpoint, model }),
    signal
  });
}
