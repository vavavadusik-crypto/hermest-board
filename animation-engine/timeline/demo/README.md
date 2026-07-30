# Hermest Animation Engine demo

Собрать самодостаточное CSS-демо и данные таймлайнов:

```bash
node demo/build-demo.mjs
```

Снять кадры через `seek()` ядра и собрать настоящий MP4:

```bash
node demo/render-mp4.mjs
```

## Счётчик FPS

В самоиграющем `demo/out/demo.html` число FPS анимировано CSS-обходом через
анимируемое пользовательское CSS-свойство и счётчик, а не `numberValue`
движка. Страница остаётся без `<script>`. Путь `seek()` — и, следовательно,
MP4 — использует настоящее `numberValue` ядра.
