# TrendVideo — AI тренд-видео платформасы

Пайдаланушы тренд видео үлгісін таңдайды, бет фотоларын жүктейді, KZT-мен төлейді және өз беті бар AI видеосын алады. Бүкіл интерфейс (клиент және әкімші) қазақ тілінде, локаль `kk-KZ`, валюта `KZT`.

**Өндіріс:** https://aivideo-ix0x.onrender.com  ·  **Жол картасы:** [ROADMAP.md](ROADMAP.md)

---

## Архитектура

| Қабат | Технология |
|---|---|
| Frontend + сервер | Next.js 16 (App Router, Server Actions, Cache Components), TypeScript, Tailwind CSS 4 |
| БД, аутентификация, файлдар | Supabase: PostgreSQL + RLS, Auth, Storage (жабық бакеттер), Vault |
| Фондық жұмыстар | БД-кезек `generation_jobs` + `pg_cron`/`pg_net` → `/api/worker/tick` |
| Хостинг | Render (web service, `main` тармағынан авто-деплой) |
| Төлем | `PaymentProvider` интерфейсі: `sandbox` (дайын), `kaspi` (мерчант құжаттамасын күтуде) |
| AI генерация | `GenerationProvider` интерфейсі: `dev` демо адаптері (видео жасамайды) |

```
src/
  app/(site)/        клиент беттері: басты бет, каталог, үлгі, тапсырыс, кабинет, sandbox төлем
  app/(auth)/        кіру, тіркелу, құпиясөзді қалпына келтіру
  app/admin/         әкімші панелі: шолу, үлгілер, тапсырыстар, қолданушылар, журнал
  app/api/           webhook-тар, worker, тапсырыс күйі/видео, CSV экспорт, health
  lib/i18n/kk.ts     БАРЛЫҚ интерфейс мәтіні (орталықтандырылған сөздік)
  lib/pricing.ts     баға есебі (тек серверде сенім артылады)
  lib/payments/      төлем провайдерлері, webhook өңдеу
  lib/generation/    AI провайдерлері, worker, файл сақтау мерзімі
supabase/migrations/ барлық миграциялар (Supabase-тегі нұсқа нөмірлерімен)
supabase/tests/      SQL интеграциялық тесттері
```

### Негізгі ағын
1. Әкімші үлгі жариялайды → жарияланған әр нұсқа өзгермейтін **снапшот** (`template_versions`) болып сақталады.
2. Пайдаланушы фото жүктейді → тікелей Storage-қа (бір реттік signed URL) → сервер файлдың нақты түрі мен өлшемін қайта тексереді.
3. Тапсырыс жасалады → **баға серверде** снапшоттан есептеледі, браузерге сенілмейді.
4. Төлем → провайдер **қолтаңбалы webhook** жібереді → `apply_payment_event` бір транзакцияда төлем мен тапсырысты жаңартады және генерацияны кезекке қояды.
5. Worker кезектен алады (`FOR UPDATE SKIP LOCKED`) → провайдерге жібереді → нәтижені тексеріп, жабық бакетке сақтайды.
6. Пайдаланушы видеоны 5 минуттық signed URL арқылы көреді/жүктейді.

---

## Жергілікті іске қосу

Талаптар: Node.js 24, Supabase жобасы.

```bash
npm install
cp .env.example .env.local     # мәндерді толтырыңыз
npm run dev                    # http://localhost:3000
```

Supabase-те миграцияларды қолдану: **SQL Editor**-да `supabase/migrations/*.sql` файлдарын атауы бойынша ретімен орындаңыз, немесе GitHub интеграциясын «Deploy to production» режимімен қосыңыз.

Миграциялардан кейін бір рет (SQL Editor, репоға **салмаңыз**):
```sql
select vault.create_secret('<WORKER_SECRET мәні>', 'worker_secret');
select vault.create_secret('https://<сайт>/api/worker/tick', 'worker_tick_url');
```

Бірінші бас әкімші:
```sql
update profiles set role = 'super_admin' where email = '<сіздің пошта>';
```

Supabase → Authentication → URL Configuration: **Site URL** = сайт адресі, **Redirect URLs** = `https://<сайт>/**`.

## Айнымалылар

Толық тізім — [.env.example](.env.example). Маңыздылары:

| Айнымалы | Мақсаты |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase (ашық) |
| `SUPABASE_SERVICE_ROLE_KEY` | Тек серверде. Ешқашан браузерге берілмейді |
| `APP_ENV` | `development` / `sandbox` / `production` (production-да sandbox төлем мен dev AI-ға тыйым) |
| `PAYMENT_PROVIDER` | `sandbox` немесе `kaspi` |
| `AI_PROVIDER` | `dev` (демо) немесе нақты провайдер кілті |
| `WORKER_SECRET` | `/api/worker/*` қорғанысы (Vault-тағы мәнмен бірдей) |
| `WORKER_CONCURRENCY`, `DAILY_PROVIDER_SPEND_LIMIT_USD` | Параллель генерация және тәуліктік шығын лимиті |
| `UPLOAD_RETENTION_DAYS` (7), `VIDEO_RETENTION_DAYS` (90) | Фото мен видеоны сақтау мерзімі |

## Деплой (Render)

- Build: `npm install && npm run build` · Start: `npm start` · Node `24.x` (`package.json` → `engines`).
- `main` тармағына push → авто-деплой. Health: `GET /api/health` (құпия мәндерді көрсетпейді).

---

## Kaspi Pay қосу

Kaspi интернет-эквайринг API құжаттамасы мен кілттерін тек мерчант шартынан кейін береді, сондықтан адаптер болжаммен жазылмаған.

1. Kaspi-мен мерчант шартын жасасып, API құжаттамасын, `merchant id`, API кілті және callback қолтаңба құпиясын алыңыз.
2. `src/lib/payments/kaspi.ts` файлын толтырыңыз:
   - `createPayment` — төлем/шот жасап, `{ providerPaymentId, redirectUrl }` қайтарады;
   - `verifyWebhook` — Kaspi қолтаңбасын тексеріп, статусты `succeeded | failed | cancelled | refunded`-ке сәйкестендіреді (тексерілмесе `null`);
   - `refund` — ақша қайтару.
3. Kaspi кабинетінде callback адресі: `https://<сайт>/api/payments/webhook/kaspi`.
4. Render-ге: `KASPI_MERCHANT_ID`, `KASPI_API_KEY`, `KASPI_WEBHOOK_SECRET`, `KASPI_API_BASE_URL`, `PAYMENT_PROVIDER=kaspi`, `APP_ENV=production`.
5. Kaspi sandbox ортасында толық тізбекті тексеріңіз.

Webhook-тан кейінгі өңдеу (idempotency, сома/валюта тексерісі, қос төлемнен қорғау) провайдерге тәуелсіз — `src/lib/payments/process.ts` және `apply_payment_event` SQL функциясы.

## AI провайдерін қосу

1. Провайдер **бар видеодағы бірнеше бетті ауыстыруды** шынымен қолдайтынын, коммерциялық лицензиясын, лимиттері мен бағасын тексеріңіз.
2. `src/lib/generation/<name>.ts` — `GenerationProvider` интерфейсін іске асырыңыз (`capabilities`, `validateInputs`, `submit`, `getStatus`, қажет болса `cancel`). Сәтсіздікте `ProviderError(code, retryable)` лақтырыңыз; `retryable=true` тек провайдер тапсырманы қабылдамаған (ақы алынбаған) жағдайда.
3. `src/lib/generation/index.ts`-ке тіркеңіз, әкімші редакторындағы «Провайдер» тізіміне қосыңыз.
4. Кірістер детерминді: 1-слот → `face_1`, 2-слот → `face_2` … (солдан оңға). Провайдердің кіріс атауларына сәйкестендіру — үлгінің «Провайдер баптауы (JSON)» өрісінде.
5. Render-ге провайдер кілттерін және `AI_PROVIDER` қойыңыз.

---

## Тесттер

```bash
npm test          # юнит-тесттер (vitest): баға, бет слоттары, рұқсаттар, жүктеу валидациясы, sandbox webhook қолтаңбасы
npm run test:db   # SQL интеграциялық тесттері: барлық миграция + төлем күй машинасы, кезек, rate limit, RLS, аккаунтты өшіру
```

`test:db` уақытша жергілікті Postgres іске қосады (немесе `TEST_DATABASE_URL`). **Ешқашан өндіріс базасына бағыттамаңыз.**
Mock тесттер (`src/**/*.test.ts`) нақты провайдерлерге қосылмайды. Нақты Kaspi / AI sandbox-ына қарсы интеграциялық тесттер кілттер алынғаннан кейін қосылады.

## Қауіпсіздік және құпиялылық

- Supabase RLS: қолданушы тек өз тапсырысын/файлын көреді; рөлді өзгерте алмайды.
- Рөлдер: `super_admin`, `template_manager` (ақша қайтара алмайды), `order_support` (баға/үлгі өзгерте алмайды). Әр әрекет серверде тексеріледі және `audit_logs`-қа жазылады.
- Барлық бакет жабық (үлгі медиасынан басқа); файлдар 5 минуттық signed URL арқылы беріледі; түрі мен өлшемі бакет деңгейінде де шектелген.
- Rate limit: кіру, тіркелу, құпиясөз, тапсырыс, төлем.
- Заголовоктар: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer/Permissions-Policy.
- Фото 7 күннен, видео 90 күннен кейін автоматты өшіріледі (pg_cron, күн сайын 02:23 Алматы).
- Аккаунтты өшіру: профиль, фото, видео өшеді; тапсырыс пен төлем атсыз қалады.

## Белгілі шектеулер / қалған жұмыс

- **Kaspi Pay** — мерчант шарты мен API құжаттамасы керек (қазір sandbox).
- **AI провайдері** — таңдалмаған; демо адаптер видео жасамайды және мұны ашық айтады.
- Supabase Auth: **Leaked password protection**-ды қосыңыз (Authentication → Passwords).
- Құқықтық беттер (құпиялылық, шарттар, қайтару) — мәтіні заңгермен дайындалуы керек.
- Транзакциялық хаттар (төлем, видео дайын) — пошта провайдері таңдалғаннан кейін.
- Supabase Free: 1 ГБ файл қоймасы, Render Free: 15 мин бос тұрса ұйықтайды — өндірісте ақылы тарифке көшу ұсынылады.
