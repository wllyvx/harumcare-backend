# HarumCare Backend

Backend untuk platform HarumCare — mengelola konten terbitan, kampanye donasi, dan konsultasi di atas Hono + D1 + R2.

## Language

### Publishing

**PublishableContent**: Entitas yang dapat diterbitkan dan ditampilkan sebagai daftar/detail — mencakup news, blog, dan kajian.

_Avoid_: Content, Article, Post, Kajian sebagai istilah umum

**ContentType**: Varian PublishableContent yang menentukan shape dan capability — `news` | `blog` | `kajian`.

_Avoid_: type, kind, category (category adalah klasifikasi topik di dalam ContentType)

**Slug**: Identitas URL human-readable turunan title, unik per ContentType.

_Avoid_: permalink, urlKey

**ViewCount**: Penghitung tayang derived yang hanya bertambah via pembacaan detail, bukan field writable.

_Avoid_: views, hits, counter

### Authorship

**Author**: User yang membuat PublishableContent, direferensikan via `authorId` dan dipopulasi sebagai `{nama, username}`.

_Avoid_: writer, creator, owner

### Campaign Link

**Campaign**: Entitas donasi terpisah yang dapat ditautkan ke PublishableContent via `campaignId` FK.

_Avoid_: program, project

**CampaignRef**: Proyeksi minimal Campaign yang dipopulasi di PublishableContent — `{title, imageUrl}`.

_Avoid_: campaignId object, relatedCampaign
