// Сезон как продукт: тема → библия сериала и список серий, каждая со своими
// битами и фактами, которые она передаёт дальше. Здесь только проводка —
// выбор текст-модели и проверка её доступности; вся логика плана и вся
// валидация ответа модели живут в domain/series-plan.js.
//
// Сервис намеренно НЕ снимает серии: план дешёвый и быстрый, а рендер сезона —
// это N отдельных длинных операций, которые человек запускает по одной, видя
// перед собой структуру. Иначе один клик уводил бы ноут в многочасовой прогон.

import { buildEpisodeBrief, planSeriesFromTopic } from "../domain/series-plan.js";
import { describeBridgeAvailability } from "../media/text-model.js";

import { createDraftTextModel } from "./draft-service.js";

const MAX_TOPIC_CHARS = 300;

export async function planSeriesService({
  topic,
  language = "ru",
  episodeCount,
  episodeDurationSeconds = null,
  audience,
  tone,
  model,
  endpoint,
  signal,
  textModel,
  availabilityCheck = null
} = {}) {
  const cleanTopic = String(topic ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_CHARS);
  if (!cleanTopic) throw new TypeError("series topic is required");

  // Та же развилка, что у драфта: прямой провайдер и локальный CLI не зависят
  // от браузерного моста, проверять его в этих режимах — блокировать без причины.
  if (endpoint?.kind !== "openai" && endpoint?.kind !== "cli") {
    const availability = await (availabilityCheck || describeBridgeAvailability)();
    if (availability?.status !== "executable") {
      const reason = availability?.reason || "text model bridge is not available";
      throw Object.assign(new Error(reason), { statusCode: 503 });
    }
  }

  const plan = await planSeriesFromTopic({
    topic: cleanTopic,
    language,
    episodeCount,
    episodeDurationSeconds,
    audience,
    tone,
    textModel: textModel || createDraftTextModel({ endpoint, model }),
    signal
  });

  // Брифы считаются здесь же: клиенту нужен не только список серий, но и то,
  // с чем каждая пойдёт в режиссёра, — иначе преемственность останется
  // обещанием, которое невозможно увидеть до самой съёмки.
  const episodes = plan.episodes.map(episode => ({
    ...episode,
    brief: buildEpisodeBrief({ plan, episodeNumber: episode.number })
  }));

  return { plan: { ...plan, episodes } };
}
