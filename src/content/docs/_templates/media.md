---
title: Описание фотографии
draft: true
entity: media
mediaType: photo
subjects: []
eventRefs: []
sidebar:
  hidden: true
---

Добавьте локальное изображение рядом с этой записью и заполните, например:

```yaml
image: ./photo.jpg
alt: Краткое описание изображения
caption: Подпись к фотографии
date: 1925
subjects:
  - person: 1900-1909/example-person.md
    focal:
      x: 0.5
      y: 0.4
place: example-place.md
eventRefs:
  - 1925/example-event.md
source: example-source.md
photographer: Имя фотографа
credit: Архив или владелец
rights: Сведения о правах
license: Лицензия
```

Галереи людей строятся автоматически из `subjects`; список фотографий в карточку человека вручную не добавляется.
