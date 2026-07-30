export const layout = Object.freeze({ width: 1920, height: 1080 });
export const seed = 91427;

export const scenes = Object.freeze([
  {
    key: "act1",
    styleName: "keynote",
    label: "keynote · сдержанно и дорого",
    intent: {
      id: "act1",
      role: "hero",
      durationMs: 7000,
      transitionIn: { kind: "dissolve", durationMs: 450 },
      transitionOut: { kind: "dissolve", durationMs: 450 },
      camera: { move: "push-in" },
      elements: [
        { id: "kicker", kind: "kicker", text: "HERMEST", depth: 0.9 },
        { id: "headline", kind: "headline", text: "Hermest Board", depth: 1.15 },
        { id: "lead", kind: "lead", text: "Доска, из которой собирается ролик", depth: 1.05 },
        { id: "card-intro", kind: "panel", text: "Сцена 1 · интро", lines: ["Хук · 00:00–00:07", "Голос · готов"], depth: 0.7 },
        { id: "card-problem", kind: "panel", text: "Сцена 2 · проблема", lines: ["Конфликт · в фокусе", "Текст · проверен"], depth: 1.0 },
        { id: "card-solution", kind: "panel", text: "Сцена 3 · решение", lines: ["Сборка · автоматически", "Переход · dissolve"], depth: 1.3 },
        { id: "card-outro", kind: "panel", text: "Сцена 4 · финал", lines: ["Рендер · 30 fps", "Статус · готово"], depth: 0.9 }
      ]
    }
  },
  {
    key: "act2",
    styleName: "motion",
    label: "motion · динамика и характер",
    intent: {
      id: "act2",
      role: "body",
      durationMs: 7000,
      transitionIn: { kind: "dissolve", durationMs: 350 },
      transitionOut: { kind: "dissolve", durationMs: 450 },
      camera: { move: "drift-right" },
      elements: [
        { id: "kicker", kind: "kicker", text: "КАК ЭТО РАБОТАЕТ", depth: 0.9 },
        { id: "headline", kind: "headline", text: "Пишешь карточки — получаешь видео", depth: 1.16 },
        { id: "body1", kind: "body", text: "Сценарий живёт в карточках", depth: 1.04 },
        { id: "body2", kind: "body", text: "Голос и субтитры собираются сами", depth: 1.02 },
        { id: "body3", kind: "body", text: "Рендер — одной кнопкой", depth: 1 },
        { id: "card-intro", kind: "panel", text: "Сцена 1 · интро", lines: ["Хук · утверждён", "Ритм · 07 сек"], depth: 0.7 },
        { id: "card-problem", kind: "panel", text: "Сцена 2 · проблема", lines: ["Смысл · раскрыт", "Голос · готов"], depth: 1.0 },
        { id: "card-solution", kind: "panel", text: "Сцена 3 · решение", lines: ["Таймлайн · собран", "Субтитры · готовы"], depth: 1.3 },
        { id: "card-outro", kind: "panel", text: "Сцена 4 · финал", lines: ["Рендер · в очереди", "Экспорт · MP4"], depth: 0.9 }
      ]
    }
  },
  {
    key: "act3",
    styleName: "cinematic",
    label: "cinematic · камера и глубина",
    intent: {
      id: "act3",
      role: "hero",
      durationMs: 8000,
      transitionIn: { kind: "dissolve", durationMs: 550 },
      transitionOut: { kind: "dissolve", durationMs: 450 },
      camera: { move: "push-in" },
      elements: [
        { id: "kicker", kind: "kicker", text: "ДВИЖОК", depth: 0.78 },
        { id: "number", kind: "number", from: 0, to: 60, suffix: " fps", depth: 1.3 },
        { id: "lead", kind: "lead", text: "Одна функция времени. Один и тот же кадр в браузере и в рендере.", depth: 0.92 },
        { id: "headline", kind: "headline", text: "Hermest Board", depth: 1.12 },
        { id: "card-intro", kind: "panel", text: "Сцена 1 · интро", lines: ["Кадры · 000–210", "Переход · готов"], depth: 0.7 },
        { id: "card-problem", kind: "panel", text: "Сцена 2 · проблема", lines: ["Кадры · 197–407", "Глубина · 1.0"], depth: 1.0 },
        { id: "card-solution", kind: "panel", text: "Сцена 3 · решение", lines: ["Кадры · 394–633", "Глубина · 1.3"], depth: 1.3 },
        { id: "card-outro", kind: "panel", text: "Рендер · финал", lines: ["60 fps · ядро", "MP4 · готово"], depth: 0.9 }
      ]
    }
  }
]);

export const intents = Object.freeze(scenes.map(({ intent }) => intent));
