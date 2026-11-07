/** Journal: plain-Russian names and groups for every logged action / event. */
export type Group = "admin" | "client" | "pay" | "gen" | "account" | "msg" | "system";

export const GROUPS: Record<Group, string> = {
  admin: "Действия админов", client: "Клиенты на сайте", pay: "Оплаты", gen: "Генерация",
  account: "Входы и аккаунты", msg: "Сообщения бота", system: "Система",
};

export const EVENTS: Record<string, { label: string; group: Group; tone?: "good" | "bad" }> = {
  "order.photos_viewed": { label: "Админ открыл фото клиента", group: "admin" },
  "generation.kling_task": { label: "Задача Kling отправлена", group: "gen" },
  "settings.gemini_billing": { label: "Баланс Gemini изменён", group: "admin" },
  "template.shot_map": { label: "Отметки сцен шаблона", group: "admin" },
  "catalog.split_shots": { label: "Режим «по сценам»", group: "admin" },
  "catalog.require_analysis": { label: "ИИ-анализ обязателен/нет", group: "admin" },
  // analytics_events (customers)
  template_viewed: { label: "Открыл шаблон", group: "client" },
  preview_played: { label: "Смотрел превью", group: "client" },
  upload_started: { label: "Начал загрузку фото", group: "client" },
  upload_completed: { label: "Загрузил фото", group: "client" },
  quality_selected: { label: "Выбрал качество", group: "client" },
  checkout_initiated: { label: "Нажал «Оплатить» (заказ создан)", group: "pay" },
  payment_succeeded: { label: "Оплата прошла", group: "pay", tone: "good" },
  payment_failed: { label: "Оплата не прошла", group: "pay", tone: "bad" },
  discount_used: { label: "Использована скидка", group: "pay" },
  generation_started: { label: "Генерация запущена", group: "gen" },
  generation_succeeded: { label: "Видео готово", group: "gen", tone: "good" },
  generation_failed: { label: "Ошибка генерации", group: "gen", tone: "bad" },
  video_downloaded: { label: "Скачал видео", group: "client" },
  photos_kept: { label: "Сохранил фото на 30 дней", group: "client" },
  guest_created: { label: "Новый гость (загрузил фото без входа)", group: "account" },
  telegram_login: { label: "Вход через Telegram", group: "account" },
  telegram_linked: { label: "Гость привязал Telegram", group: "account", tone: "good" },
  reminder_sent: { label: "Бот: напоминание об оплате", group: "msg" },
  offer_sent: { label: "Бот: скидка на второе видео", group: "msg" },
  // audit_logs (staff + system)
  "template.create": { label: "Шаблон создан", group: "admin" },
  "template.update": { label: "Шаблон изменён", group: "admin" },
  "template.publish": { label: "Шаблон опубликован", group: "admin" },
  "template.unpublish": { label: "Шаблон снят с публикации", group: "admin" },
  "template.delete": { label: "Шаблон удалён", group: "admin", tone: "bad" },
  "template.pricing_changed": { label: "Цена шаблона изменена", group: "admin" },
  "template.bulk_photo": { label: "Фото-шаблоны: массовое изменение", group: "admin" },
  "category.delete": { label: "Категория удалена", group: "admin" },
  "combo.create": { label: "Фото-комбо создано", group: "admin" },
  "home.showcase_update": { label: "Главная: витрина изменена", group: "admin" },
  "seedance_pricing.update": { label: "Цены генерации изменены", group: "admin" },
  "akool_pricing.update": { label: "Цены Akool изменены", group: "admin" },
  "custom_video.settings": { label: "Настройки «Своё видео»", group: "admin" },
  "pixels.settings": { label: "Пиксели и аналитика изменены", group: "admin" },
  "telegram.setup": { label: "Telegram-бот подключён", group: "admin" },
  "user.role_change": { label: "Роль пользователя изменена", group: "admin" },
  "role.grant": { label: "Выдана роль", group: "admin" },
  "user.free_orders_on": { label: "Включены бесплатные заказы", group: "admin" },
  "user.free_orders_off": { label: "Выключены бесплатные заказы", group: "admin" },
  "partner.create": { label: "Партнёр создан", group: "admin" },
  "partner.update": { label: "Партнёр изменён", group: "admin" },
  "order.refund": { label: "Возврат по заказу", group: "pay", tone: "bad" },
  "order.free": { label: "Бесплатный заказ", group: "pay" },
  "photos.delete_all": { label: "Клиент удалил все фото", group: "client" },
  "retention.run": { label: "Автоочистка файлов", group: "system" },
};

export const info = (name: string, fromAudit: boolean) =>
  EVENTS[name] ?? { label: name, group: (fromAudit ? (name.startsWith("retention") ? "system" : "admin") : "client") as Group };
