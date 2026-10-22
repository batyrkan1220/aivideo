import { connection } from "next/server";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BOT_MESSAGES, BOT_MESSAGE_KEYS, botMessageOverrides, clearBotMessageCache } from "@/lib/telegram/messages";
import { BotMessageForm } from "./message-form";

export const metadata = { title: ru.admin.bot.title };

export default async function BotMessagesPage() {
  await connection();
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return <p className="py-16 text-center text-muted">{ru.admin.forbidden}</p>;
  clearBotMessageCache();
  const saved = await botMessageOverrides();
  const fmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Almaty" });
  const B = ru.admin.bot;
  const groups = ["commands", "notifications", "profile"] as const;
  return (
    <div>
      <h1 className="font-display text-2xl font-bold">{B.title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">{B.lead}</p>
      {groups.map((g) => (
        <section key={g} className="mt-8">
          <h2 className="text-lg font-semibold">{B.groups[g]}</h2>
          {g === "profile" && <p className="mt-1 text-sm text-muted">{B.profileNote}</p>}
          <div className="mt-3 grid gap-4">
            {BOT_MESSAGE_KEYS.filter((k) => BOT_MESSAGES[k].group === g).map((k) => {
              const def = BOT_MESSAGES[k];
              const row = saved.get(k);
              return (
                <BotMessageForm
                  key={`${k}-${row?.updated_at ?? "default"}`}
                  k={k}
                  label={B.labels[k]}
                  text={row?.text ?? def.text}
                  button={def.button === null ? null : (row?.button ?? def.button)}
                  max={def.max}
                  vars={def.vars}
                  customizedAt={row ? fmt.format(new Date(row.updated_at)) : null}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
