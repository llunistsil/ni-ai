# Nitro3 Examples Pack

Эталонные примеры конфигов для базы знаний AI-генерации. Каждый пример — маленький,
проходит валидацию и показывает один механизм платформы. Схема — источник истины
про структуру; в «Правилах» ниже только то, что схемой невыразимо (поведение).

Все файлы проходят двухуровневую валидацию (`tools/validate.mjs`):
структурную по `schema/configSchema.json` (ajv) и семантическую (ссылки глобальных
и локальных биндингов разрешаются в области видимости компонента, дубликаты id).
Канонический конфиг `canonical/nitro-editor.yaml` проходит обе — приёмочный тест валидатора.

## Запуск

```bash
npm i
npm run validate                       # все примеры + канон
node tools/agent.mjs "описание"        # генерация конфига через LLM Proxy (см. tools/agent.mjs)
node tools/sandbox.mjs <url> --mocks eval/mocks/04-client.json   # смоук в Chromium с моками
node tools/sandbox.mjs <url> --mocks ... --headed                # ручная приёмка с моками
```

Для sandbox один раз: `npx playwright install chromium`. Моки живут на стороне
проверяющего браузера — фронт и бэк не меняются; формат mocks-файла единый
для всех фаз (см. шапку `tools/sandbox.mjs`).

## Индекс примеров

| Файл | Что показывает |
|---|---|
| `01-layout-basics.yaml` | Раскладка (panel/container, flex/grid в style), text, icon, badge, avatar, image, `var(--tui-*)` |
| `02-model-counter.yaml` | Модель как состояние: set/setInputs, context, JSONata vs NitroPayload, управление visible |
| `03-form-textfields.yaml` | Форма: событие `text`, производное значение, condition на биндинге, disabled-логика, alerts |
| `04-datasource-http.yaml` | HTTP-источник: send, success/failure/inProgress, loader, ветвление condition на action |
| `05-dynamic-list.yaml` | Динамический список: JSONata-map → componentPresenter, дочерний компонент, `$append` |
| `06-component-props.yaml` | Компонент с input-пропсами: статичные `inputs`, setInputs по id презентера, триггер `COMPONENT` |
| `07-router-navigation.yaml` | Роутинг: router, link `mode: navigate`, сервис navigation (`navigate`, `urlState`), browserTab |
| `08-dropdown-menu.yaml` | Dropdown/menu/menuGroup, `meta` + `<groupId>.click.meta`, закрытие через `{open: false}` |
| `09-tabs.yaml` | Вкладки: title/content — любые примитивы, activeTabIndex, meta |
| `10-microfrontend.yaml` | МФ: url + initialConfig, `setInputs {mfInput}`, триггер `mfOutput` (URL — заглушка) |
| `11-local-bindings.yaml` | localBindings: inputs (value = само значение) и outputs; чего избегать — см. правило 6 |
| `12-timer.yaml` | Сервис timer: mode/interval/timerType, экшены start/stop без payload, tick/isStarted |
| `canonical/nitro-editor.yaml` | Полное реальное приложение: вложенные компоненты, роутинг по параметру, версии, МФ |

Служебное (агент это не читает): `runtime-checks/` — пробы поведения для стенда,
`eval/tasks.md` — задачи e2e-прогона, `TESTING.md` — план тестирования.

## Правила (только то, что схемой не проверяется)

1. `set` на модели — всегда полная замена состояния, не merge. Текущее состояние
   читается через `context`, новый объект собирается целиком.
2. Подписка на выходы любой сущности единообразна: `triggers: {id: [имяСобытия]}`.
   Имена событий и экшенов в схеме не описаны — источник: примеры
   (click, state, text, success/failure/inProgress, urlState, tick/isStarted, mfOutput).
3. Динамические списки: JSONata-map в массив `componentPresenter`-ов через
   `setInputs {items: [...]}`. Внешние `[ ]` обязательны — JSONata схлопывает
   массив из одного элемента.
4. Интерполяция `"{COMPONENT.appId}"` в NitroPayload работает только для значений
   из `context`/триггеров этого биндинга.
5. condition на уровне биндинга отсекает весь запуск; condition на уровне action —
   ветвление внутри одного биндинга (см. 04).
6. localBindings: в `inputs` выражение `value` возвращает само значение инпута —
   обёртку `{имя: значение}` делает KeyValue-трансформер. В `outputs` собственные
   данные события доступны по имени события на верхнем уровне (Spread по selfId),
   context — по их id. Известный баг: `outputs`/`actions`-блоки с `context`/`condition`
   считаются по неполному DTO и молча не срабатывают (наша отладка на тетрисе
   и сапёре) — до подтверждения фикса такую логику держать в глобальных биндингах.
7. Output-пропсы компонентов: `direction: output/bidirectional` объявляемы
   (встречаются в каноне), но механики передачи наверх нет — не использовать.
   Интерактив, влияющий на родителя, держать в родительской области видимости
   (паттерн селекторов в каноне: кнопка удаления живёт у родителя).

## Изменения схемы в этом пакете (v0.2 относительно исходной)

1. Добавлены `localBindings` (definitions `localBindings`, `localInputBinding`,
   `localOutputBinding`, `localActionBinding`, `bindingSources`) на всех примитивах,
   кроме `component`; `bindingAction` извлечён в отдельное определение и
   переиспользован в глобальных биндингах и в `outputs.actions` (объект или массив).
2. `dataSource`: добавлено `mode` (`onLoad` | `manual` — по аналогии с таймером,
   поправь, если значений больше).
3. Сервис `timer`: добавлено `mode` (`onLoad` | `manual`) по докам.
4. `link.isActiveMatchOptions`: `ignoreBaseHref` перенесён внутрь `properties`
   (лежал рядом и игнорировался).
5. `menuGroup`: добавлен `additionalProperties: false` (как у остальных примитивов).

## Открытые вопросы

Закрыто: механики output-пропсов нет — зафиксировано правилом 7.
Остальное переведено в план тестирования `TESTING.md`: статус бага
outputs+context (проба), стендовый прогон эталонов, калибровка схемы
на реальных конфигах из конфигли, e2e-прогон агента по `eval/tasks.md`.
