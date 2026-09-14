# Переписывание расширения Make It Shorter

Задание для ИИ-агента. Сквозные решения по продукту — в `CLAUDE.md`, при конфликте прав `CLAUDE.md`. После выполнения этот файл удаляется.

## 0. Рамки

- `apps/extension` переписывается с нуля. Стек: TypeScript, React, Tailwind v4, shadcn/ui, Vite, Chrome MV3. Из старого кода допустимо перенести только чистые модули с их тестами: SSE-парсер, `normalizeText`/`countCodePoints`, `sha256Hex`, `getDeviceId`, `manifest.ts` (версия из git-тега, `EXTENSION_KEY`), `scripts/check-boundaries.mjs`, `scripts/check-locales.mjs`. Весь UI, воркер, content script и состояние — новые.
- `apps/backend` правится точечно, раздел 5. Стиль — наивный, читаемый, см. `CLAUDE.md`.
- `infra/terraform` — одна переменная, раздел 6.
- Код, комментарии, коммиты — на английском. Строки интерфейса панели — английские литералы, без `chrome.i18n`.

## 1. Что удаляется из расширения

- Плавающая иконка на выделении, контекстное меню, горячая клавиша (`commands`), резидентный content script на `<all_urls>`, `host_permissions: <all_urls>`, `web_accessible_resources`.
- Кнопка «Shorten entire page content» и вся логика блокировки по `tabId` (`unreadable.tabId`, слушатели `tabs.onActivated` / `tabs.onUpdated`).
- Самописный `Picker` с type-ahead — вместо него shadcn `Select`.
- Эмодзи в подписях тонов, 11 из 15 тонов (раздел 9).
- Разделение `pt-BR`/`pt-PT` и `zh-Hans`/`zh-Hant` (раздел 8).

## 2. Манифест

```
manifest_version: 3
name: "__MSG_extName__"            description: "__MSG_extDescription__"
default_locale: "en"               (30 каталогов _locales остаются как есть)
version / version_name: из git, как в текущем manifest.ts
key: EXTENSION_KEY из окружения сборки (без него — предупреждение сборки)
permissions: ["storage", "sidePanel", "activeTab", "scripting"]
host_permissions: ["https://api.make-it-shorter.net/*"]
action: default_title "__MSG_actionTitle__", иконки 16/32/48/128
side_panel: { default_path: "sidepanel.html" }
background: { service_worker: "background.js", type: "module" }
```

Нет `content_scripts`, `commands`, `contextMenus`, `web_accessible_resources`, `tabs`. Строка `actionTitle` во всех 30 локалях меняется на «Open Make It Shorter» (перевод на каждый язык). `contextMenuSelection` и `floatingIconTitle` из всех `messages.json` удаляются.

**Почему `activeTab`, а не `<all_urls>`.** Единственная функция, требовавшая доступа ко всем сайтам, — иконка у выделения, — удалена. `activeTab` даёт доступ к вкладке по клику на иконку расширения, без предупреждения «чтение данных на всех сайтах» при установке и без длинного трека ревью. Цена: выделение отслеживается только на вкладках, где по иконке кликали.

## 3. Поверхности

| Поверхность | Файл | Что делает |
|---|---|---|
| Service worker | `src/background/index.ts` | открывает панель по клику, внедряет content script, извлекает текст, шлёт задания панели |
| Content script | `src/content/index.ts` → `content.js` | внедряется по требованию; извлечение текста, отслеживание выделения |
| Side panel | `sidepanel.html`, `src/sidepanel/**` | весь интерфейс и сетевой запрос |
| Окно вывода | `output.html`, `src/output/**` | результат в отдельном окне: прочитать, скопировать, закрыть |

Сетевой запрос делает **только панель**: воркер Chrome выгружает при простое, а панель живёт, пока открыта.

### Service worker

- `onInstalled`: при `reason === "install"` открыть `https://make-it-shorter.net/welcome`; всегда — `chrome.storage.local.remove(["history", "catalogVersion", "ratio"])`.
- `chrome.runtime.setUninstallURL("https://make-it-shorter.net/uninstall")`.
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })` — иначе `action.onClicked` не срабатывает и запускать извлечение неоткуда.
- `action.onClicked(tab)`: `chrome.sidePanel.open({ tabId })` → внедрить `content.js` через `chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })` → `chrome.tabs.sendMessage(tabId, { type: "extract" })` → результат в панель заданием (ниже). Любое исключение на пути (служебная страница `chrome://`, магазин Chrome, просмотрщик PDF, `file://` без галочки) → задание `{ kind: "unreadable" }`.
- Порт `panel`: панель подключается при монтировании. Задание, пришедшее до подключения, ждёт в `pendingJob` и отдаётся при `onConnect`. Панель переподключается через 1 с после `onDisconnect`.
- `runtime.onMessage` `selection-changed` от content script → переслать панели заданием `{ kind: "fill", text, truncated }`, если порт есть; иначе молча отбросить.

Задания панели:

```ts
type PanelJob =
  | { kind: "text"; text: string; source: "selection" | "page"; truncated: boolean }
  | { kind: "fill"; text: string; truncated: boolean }
  | { kind: "unreadable" };
```

### Content script

Один бандл (IIFE, без импортов), Readability внутри. Внедряется только по клику, поэтому лениво грузить ничего не нужно. Идемпотентность: при повторном внедрении (`window.__makeItShorterInjected`) второй экземпляр не ставит слушателей, но обработчик `extract` работает.

- `extract`: выделение (`window.getSelection().toString()`) после `normalizeText` непустое → `{ ok: true, text, source: "selection", truncated }`. Иначе страница: `isProbablyReaderable(document)` ложно → `{ ok: false }`; `new Readability(document.cloneNode(true)).parse()?.textContent`; пусто → `document.body.innerText`; после нормализации пусто → `{ ok: false }`; иначе `{ ok: true, text, source: "page", truncated }`.
- Отслеживание выделения: `selectionchange` с debounce 300 мс. Выделение не в `input`, `textarea`, `[contenteditable]`, после нормализации ≥ `MIN_INPUT` code points → `chrome.runtime.sendMessage({ type: "selection-changed", text, truncated })`. Ошибку `sendMessage` (расширение перезагружено) глотать.

### Нормализация текста (клиент)

Ровно три действия: обрезка пробелов по краям; схлопывание горизонтальных пробелов в один, `\r\n` → `\n`, трёх и более переводов строки в два; обрезка до `MAX_INPUT = 30 000` code points с флагом `truncated`. Чистка «мусора» из плоского текста запрещена — это работа Readability на DOM и модели.

Длина везде считается в code points: `[...str].length`. `MIN_INPUT = 50`.

## 4. Поведение

- **Единственный вход — иконка в тулбаре.** Клик открывает панель и читает активную вкладку: выделение, если оно есть, иначе страницу целиком. Текст попадает в поле ввода. **Запрос не отправляется.** Единственный способ потратить запрос — кнопка Shorten.
- Повторный клик по иконке при открытой панели — то же самое: перечитать вкладку и заменить поле ввода. Это и есть способ обновить текст после навигации или на другой вкладке.
- Выделение на вкладке, где content script внедрён, ≥ 50 символов → заменяет поле ввода. Переключение вкладок и навигация сами по себе поле не трогают.
- Пока идёт стриминг, задания `text` и `fill` **игнорируются**: подменить вход под работающим запросом — оставить на экране результат от другого текста.
- Задание `unreadable`: поле ввода не трогается, под ним появляется подсказка (раздел 5). Это не ошибка.
- Панель, открытая не по иконке (меню боковой панели Chrome), стартует пустой: доступа к вкладке нет, читать нечего.
- Поле ввода редактируется всегда, включая стриминг. Правка сбрасывает подсказки и ошибки; `source` становится `manual`.
- Смена языка или тона не перезапускает запрос — действует на следующий Shorten. Оба значения пишутся в `chrome.storage.local` в момент выбора.
- Панель держит один результат — тот, что на экране. Истории нет. Закрытие панели теряет всё.

## 5. Панель: интерфейс

Одна колонка, три области сверху вниз, панель занимает всю высоту, прокручиваются только поля. Внизу закреплена полоса оценки. Стили — shadcn-токены, светлая и тёмная тема по `prefers-color-scheme`. Все надписи в Sentence case.

### Input area

```
Input text                                    1,234
┌──────────────────────────────────────────────────┐
│ <Textarea>                                       │
└──────────────────────────────────────────────────┘
<подсказка, одна строка, только когда есть что сказать>
```

- Label «Input text» слева, счётчик code points справа на той же строке (`toLocaleString("en-US")`).
- Подсказка под полем, приоритет сверху вниз:
  - `unreadable`: «This page has no readable text to shorten. Paste the text here instead.»
  - `0 < длина < 50`: «Add N more characters to shorten this text.» (N, «character/characters»).
  - `длина > 30 000`: «This text is N characters over the limit.»
  - `truncated`: «The page was long, so only its first 30,000 characters were read.»

### Control area

```
Output language              Tone
[ English            ▾ ]     [ Simplified        ▾ ]
[                  Shorten                          ]
```

- Два блока в один ряд по половине ширины, над каждым `Label`, под ним shadcn `Select`. Длинное название языка обрезается многоточием.
- Кнопка Shorten на всю ширину, primary. Неактивна при стриминге и при длине вне `[50, 30 000]`. Во время стриминга подпись «Shortening…».

### Output area

```
Shortened text                      [⧉] [⎘]   987
┌──────────────────────────────────────────────────┐
│ <рендер markdown, прокрутка, текст выделяется>   │
└──────────────────────────────────────────────────┘
```

- Label «Shortened text» слева; справа — иконки «Open in window» и «Copy» (shadcn `Button variant="ghost" size="icon"` с `Tooltip`), затем счётчик. Иконки видны только у законченного непустого результата.
- Счётчик считает **плейн-текст** результата (раздел 5.1), в code points.
- Область вывода — не `textarea`, а прокручиваемый контейнер с отрендеренным markdown. `dir="rtl"` для `ar`, `fa`, `he`, `ur`.
- Copy: `navigator.clipboard.write` с `text/plain` (плейн-текст) и `text/html` (innerHTML контейнера). Тултип на 1,5 с меняется на «Copied».
- Область не прокручивается вслед за текстом при стриминге; новый запуск сбрасывает прокрутку наверх.

### 5.1. Рендер markdown

- Библиотека `react-markdown` + `remark-gfm` (таблицы). HTML в исходнике не рендерится (поведение по умолчанию). Разрешённые элементы: `p`, `strong`, `em`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `br`. Заголовки любого уровня рендерятся как `p` с `strong`. Ссылки — как их текст. Всё прочее (`code`, `pre`, `blockquote`, `hr`, `img`) — как обычный абзац с текстом.
- `markdownToPlainText(md): string` — чистая функция с тестами: абзацы разделены пустой строкой; пункты списков с префиксами `- ` / `1. `; строки таблицы через ` | `; выделение и заголовки без разметки. Используется счётчиком и Copy.
- Стриминг: контейнер перерендеривается на каждом `delta` из накопленной строки.

### 5.2. Состояния

| Состояние | Вид |
|---|---|
| Пусто | область вывода пустая, в ней тусклая надпись «The shortened text will appear here.» |
| Ожидание первого токена | shadcn `Skeleton`: три пульсирующие полосы в области вывода |
| Стриминг | текст дописывается; иконок нет; Shorten неактивна |
| Готово | текст + иконки Copy и Open in window |
| Ошибка | `Alert` под кнопкой Shorten с текстом по коду; частично полученный текст остаётся в области вывода |
| `service_disabled` | `Alert` с `message` сервера или своей строкой; Shorten неактивна до правки поля ввода |

Тексты ошибок:

| Код | Текст |
|---|---|
| `too_short` | This text is too short. |
| `too_long` | This text is too long. |
| `rate_limited` | Today's limit is used up. Come back tomorrow. |
| `unsupported_language` | This language is not supported yet. |
| `invalid_request` | Something went wrong. Please try again. |
| `service_disabled` | The service is temporarily unavailable. |
| `upstream_error` | The text could not be shortened. Please try again. |
| `nothing_to_shorten` | There is nothing to shorten here: this does not look like a text. |

`message` приходит только с `service_disabled` и показывается как есть.

### 5.3. Полоса оценки

Внизу панели: «Rate us», пять звёзд, крестик. Наведение подсвечивает звёзды слева до текущей. Клик по звезде → `chrome.tabs.create({ url: "https://make-it-shorter.net/rate-us?stars=N" })` и скрыть навсегда (`rated: true` в storage). Крестик — скрыть навсегда.

## 6. Окно вывода

- Иконка «Open in window» → `chrome.windows.create({ url: chrome.runtime.getURL("output.html"), type: "popup", width: 720, height: 600 })`.
- Передача текста: панель пишет `{ markdown, lang }` в `chrome.storage.session` под ключом `outputWindow` перед созданием окна; окно при загрузке читает ключ и удаляет его. `storage.session` живёт только в памяти браузера и на диск не попадает — инвариант «текст не сохраняется» не нарушается. В `storage.local` текст не пишется никогда.
- Окно: тот же рендер markdown (общий компонент), кнопки «Copy» (то же поведение) и «Close» (`window.close()`). Окно статично: новые запуски в панели его не обновляют. `<title>` — «Make It Shorter». RTL по тем же языкам.

## 7. Хранилище

`chrome.storage.local`, только эти ключи:

| Ключ | Значение | По умолчанию |
|---|---|---|
| `deviceId` | UUIDv4 | `crypto.randomUUID()` при первом обращении; пропал — пересоздаётся молча |
| `lang` | код из списка раздела 8 | `normalizeLang(chrome.i18n.getUILanguage())` |
| `tone` | id из раздела 9 | `simplified` |
| `rated` | boolean | false |

Значение вне списка текущей сборки (старый `pt-BR`, удалённый тон) → нормализовать (`pt-BR` → `pt`) или сбросить на дефолт. `storage.sync` не используется.

## 8. Языки вывода

Список задан статически: `{ code, label }`, порядок — по `label`. Подписи — как в таблице, `Intl.DisplayNames` не используется. Тот же список (код → английское имя) дублируется на сервере, раздел 10.

| code | label | | code | label |
|---|---|---|---|---|
| af | Afrikaans | | lv | Latvian |
| sq | Albanian | | lt | Lithuanian |
| ar | Arabic | | mk | Macedonian |
| hy | Armenian | | ms | Malay |
| az | Azerbaijani | | ml | Malayalam |
| bn | Bangla | | mr | Marathi |
| be | Belarusian | | nb | Norwegian |
| bg | Bulgarian | | fa | Persian |
| zh | Chinese | | pl | Polish |
| hr | Croatian | | pt | Portuguese |
| cs | Czech | | pa | Punjabi |
| da | Danish | | ro | Romanian |
| nl | Dutch | | ru | Russian |
| en | English | | sr | Serbian |
| et | Estonian | | sk | Slovak |
| tl | Filipino | | sl | Slovenian |
| fi | Finnish | | es | Spanish |
| fr | French | | sw | Swahili |
| ka | Georgian | | sv | Swedish |
| de | German | | ta | Tamil |
| el | Greek | | te | Telugu |
| gu | Gujarati | | th | Thai |
| he | Hebrew | | tr | Turkish |
| hi | Hindi | | uk | Ukrainian |
| hu | Hungarian | | ur | Urdu |
| id | Indonesian | | uz | Uzbek |
| it | Italian | | vi | Vietnamese |
| ja | Japanese | | | |
| kk | Kazakh | | | |
| ko | Korean | | | |

57 языков. `normalizeLang(tag)`: базовый субтег в нижнем регистре; алиасы `no` → `nb`, `iw` → `he`, `fil` → `tl`, `in` → `id`; региональные и письменные субтеги отбрасываются (`pt-BR` → `pt`, `zh-TW` → `zh`, `en-US` → `en`); код вне списка → `en`. Применяется только к языку браузера и к сохранённому значению; на сервер уходит код как есть.

## 9. Тоны

| id | Подпись |
|---|---|
| `simplified` | Simplified (по умолчанию) |
| `professional` | Professional |
| `casual` | Casual |
| `direct` | Direct |

Без эмодзи. Порядок — как в таблице.

## 10. Сетевой запрос

Без изменений против текущей реализации; перенести `api.ts` и `sse.ts` с тестами.

- `POST https://api.make-it-shorter.net/v1/shorten`, заголовки `Content-Type: application/json`, `X-Device-Id`, `x-amz-content-sha256` (SHA-256 тела в hex, требование OAC). Тело `{ text, lang, tone, source }`, `source ∈ selection | page | manual`.
- Ответ — SSE: `delta {text}`* → `done {tokensIn, tokensOut}` либо `error {code, message?}`. `TextDecoder` с `{ stream: true }`, буфер до `\n\n`, комментарии и неизвестные события игнорируются. Поля `done` пользователю не показываются.
- Не-200 → `upstream_error`. Поток закрылся без `done`/`error` → `upstream_error`. Абсолютный срок 60 с от старта до `done` → отмена и `upstream_error`; полученный текст остаётся.
- `runId`: события устаревшего запуска отбрасываются.

## 11. Сборка и тесты

- Vite: сборка панели, воркера и `output.html` вместе (общие чанки допустимы, имена входов фиксированы: `background.js`, `sidepanel.html`, `output.html`); `content.js` — отдельная сборка одним IIFE-файлом без импортов. Манифест пишет плагин из `manifest.ts`.
- shadcn/ui: компоненты `button`, `textarea`, `select`, `label`, `tooltip`, `skeleton`, `alert` — в `src/components/ui`, добавляются CLI shadcn. Tailwind v4.
- `npm run build` = `check:locales` (30 каталогов, каждый `messages.json` парсится) → `check:boundaries` (каждый `onMessage`-слушатель и ответ `sendMessage` типизирован `unknown`) → `tsc --noEmit` → `node --test` → сборки Vite.
- Юнит-тесты (`node --test`, без браузера): SSE-парсер (разрыв кадра и многобайтового символа между чанками), `normalizeText`/`countCodePoints`, `normalizeLang`, `markdownToPlainText`, редьюсер состояния панели, читатели сообщений (`unknown` → форма).
- `scripts/frontend-build.sh` и `scripts/make-release.sh` продолжают работать без правок: они зовут `npm run build` и берут `dist/manifest.json`.
- `apps/extension/README.md` переписать под новую структуру: сборка, `EXTENSION_KEY`, что проверить в реальном браузере.

## 12. Бэкенд: правки

Файлы: `request.go`, `prompt.go`, тесты. Всё остальное (конвейер, квота, SSE, сентинель, логи, метрики) не трогать.

1. **Тоны.** `knownTones` = `simplified`, `professional`, `casual`, `direct`. В промпте остаются четыре строки описания тонов, остальные удаляются. Тест «промпт описывает каждый тон» остаётся.
2. **Языки.** `normalizeLang`: базовый субтег, алиасы `no`→`nb`, `iw`→`he`, `fil`→`tl`, `in`→`id`; `pt-*`→`pt`, `zh-*`→`zh` (старые клиенты шлют `pt-BR`, `zh-Hans` — они должны продолжать работать). Таблица `languageNames map[string]string` — 57 кодов из раздела 8 с английскими именами. При старте: каждый код из `LANGUAGES` обязан быть в таблице, иначе фатальная ошибка конфигурации.
3. **Язык в промпте по имени.** Строка блока пользователя: `Output language: Belarusian (be)` — имя, затем код в скобках. Код сам по себе неоднозначен (`be` читается как глагол). Для `zh` имя — `Chinese (Simplified)`, для `pt` — `Portuguese`, для `nb` — `Norwegian`. Блок пользователя начинается с этой строки, и в системном промпте добавляется: «Begin in the output language from the first word.»
4. **Формат вывода.** Заменить абзац «no headings, no markdown» и «Prose is one paragraph at most» на правила:
   - по умолчанию — проза без разметки; проза не длиннее одного абзаца;
   - минимальный Markdown допустим только когда исходник структурирован или плохо читается как проза: маркированные списки `- `, нумерованные `1. `, таблица — только если таблица была в исходнике, `**жирная строка**` как заголовок раздела;
   - запрещены `#`-заголовки, ссылки, изображения, код, цитаты, разделители, HTML, эмодзи;
   - разметка не добавляет объёма: список короче исходного списка, таблица короче исходной таблицы.
   Остальные требования промпта (тот же текст короче, никакой мета-речи, роль инструмента, сентинель, температура 0.3) без изменений.
5. Тесты: обновить `TestNormalizeLang`, `TestParseShortenRequest`, `TestPromptDescribesEveryKnownTone`; добавить тест на таблицу имён (каждый код из тестового списка 57 имеет имя, `buildUserBlock` содержит `Output language: Belarusian (be)`).

## 13. Terraform

- `variables.tf`, переменная `languages` → 57 кодов из раздела 8. Комментарий к переменной обновить: варианты не разделяются, клиентский список равен серверному.
- `modules/cdn/main.tf`: убрать `X-Catalog-Version` из списка пробрасываемых заголовков — остаток удалённой функции.

Больше ничего.

## 14. Вне рамок, но известно

- `landing/welcome/index.html` ссылается на `/assets/pin-demo.mp4`, `/assets/usage1-demo.mp4`, `/assets/usage2-demo.mp4`. Файлы удалены из репозитория, теги оставлены намеренно: новые записи демо кладутся под теми же именами.
- `long-description.txt` и `long-description-ru.md` описывают кнопки-уточнения, которых нет. Листинг магазина переписывается отдельной задачей после релиза.

## 15. Готовность

- `npm run build` в `apps/extension` проходит; `go test ./...` в `apps/backend` проходит; `terraform plan` показывает только смену `LANGUAGES`.
- Ручная проверка в Chrome с `EXTENSION_KEY`: клик на статье → панель с текстом страницы; выделение → клик → панель с выделением; выделение на той же вкладке при открытой панели → поле обновилось; `chrome://extensions` → подсказка «no readable text»; Shorten → скелет → стриминг → Copy / Open in window; ошибка `too_short` при 40 символах не отправляется (кнопка неактивна); повторный Shorten на том же тексте работает; тёмная тема; `ar` → RTL в выводе; предупреждение при установке не содержит «на всех сайтах».
