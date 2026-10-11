---
title: "MyHeritage — Антон Назаров (I500001 / 1500001)"
description: "Экспорт профиля Антона Назарова и семейных связей из MyHeritage, архивирован 11 октября 2026 года"
entity: source
sourceType: "genealogical-export"
year: 2026
publication: "MyHeritage; архив Antiokh/obsidian"
url: "https://github.com/Antiokh/obsidian/tree/main/antiokh/Work%20Ideas/MyHeritage%20Exporter"
locator: "myheritage-export-userscript/data/export.json; person 1500001; GEDCOM xref I500001"
---

Экспорт MyHeritage используется для идентификации профиля Антона Назарова, точной даты и места рождения, семейных связей и портретной фотографии.

Профиль `1500001` в экспортированных данных обозначен как `This is you`; для него указаны дата рождения **21 декабря 1988 года** и место рождения **Москва**. В GEDCOM-снимке тот же человек имеет xref `I500001`.

Архив MyHeritage хранится по принципу raw-first: исходные серверные JSON сохраняются без преобразования, а `data/export.json` является нормализованным производным слоем. При расхождении нормализованного слоя с raw-ответом первичным считается raw JSON.

Фотографии в userscript-пакете дедуплицированы по SHA-256 и перекодированы в WebP с quality 65; исходный CDP-пакет сохраняет JPEG-версии. Для портрета Антона `1500001` обе версии имеют размер 328×428 px: JPEG занимает 31 064 байта, WebP — 10 784 байта.
