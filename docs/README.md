# twork-nitro-studio

UI-инструмент для сборки конфигов Nitro3 — технолог собирает примитивы, модели, биндинги и
dataSources без ручного редактирования JSON. Дополняет существующий редактор на Monaco, не
заменяет его.

Поставляется **микрофронтендом**: собирается в контейнер Module Federation и подключается
хостом (воркспейс Nitro3). Своего хостинга и неймспейса у Studio нет.

## Что в репозитории

Nx-монорепо, два приложения, ни одно не работает само по себе:

| Проект | Что это |
|---|---|
| `apps/nitro-studio` | микрофронтенд: контракт в `src/exposed/mf-studio`, код продукта в `src/studio` |
| `apps/nitro-studio-sandbox` | хост-песочница для локальной разработки и витрины QA |

Стек зафиксирован шаблоном микрофронтендов: Angular 21 standalone, Taiga UI **v4**, LESS, Jest,
ESLint 8 в формате `.eslintrc.json`. Подробнее — [ARCHITECTURE.md](ARCHITECTURE.md).

## Запуск

```bash
npm ci
npm start   # nx run nitro-studio-sandbox:serve-sandbox
```

`nx serve nitro-studio` не работает: у микрофронтенда нет `index.html`, он поднимается
только внутри песочницы.

Дальше — [CONTRIBUTING.md](CONTRIBUTING.md).

## Конфигурация

`.env` и `window.TBANK_CONFIG` не используются. Всё окружение приходит от хоста через
`mfInitialConfig`, схема — `apps/nitro-studio/metadata/mf-initial-config.metadata.ts`:
`{ nitroApiBaseUrl?: string }` — база Nitro API; по умолчанию пусто, запросы идут
относительными путями с `credentials: same-origin`. Данные Studio получает сама из
Nitro API (`libs/data-access`), от хоста они не приходят.

## Стенды

- Витрина микрофронтендов (QA): storybook-композиция из `dist/storybook-composed`
- Превью ветки: собирается пайплайном на каждый MR

TODO: конкретные URL стендов и как попасть в превью своей ветки.

## Релиз

MR вливается в master → пайплайн собирает МФ (`mfe-build`), публикует в S3/CDN
микрофронтендов, версии проставляет `npx tmf --release`. Версии и `outputPath` руками не
правятся.

## Владельцы

TODO: команда-владелец, кому писать по доступам и вопросам.

## ErrorHub

Не подключён. Для микрофронтенда трекинг настраивается через `sentryDsn` в
`generateMfeConfig` (`apps/nitro-studio/webpack.config.js`), а не провайдерами —
[инструкция](https://t.tb.ru/ritendstera).

## e2e

Тестов и проекта под них нет. Приоритетное решение в компании —
[Playwright](https://playwright.dev/) (`nx add @nx/playwright`); зависимости уже стоят.

## Ссылки

- [Nx](https://nx.dev/) — миграции: `nx migrate latest`, затем `nx migrate --run-migrations`
- [unic](http://unic.tcsbank.ru/) — деплой storybook и стендов
- [devplatform](https://devplatform.tcsbank.ru/) — управление gitlab-проектами
- [Coretech Frontend](https://wiki.tcsbank.ru/display/CORE/Coretech+Frontend) — внутренние библиотеки
- [Nx Cloud (внутренний инстанс)](https://nxify.pages.devplatform.tcsbank.ru/tinkoff-nx-cloud-v2/docs/faq)
- [Gitlab AI Code Reviewer](https://devplatform.pages.devplatform.tcsbank.ru/spirit-user-docs/docs/gitlab/ai-review)
