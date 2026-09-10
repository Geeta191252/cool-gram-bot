import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cool Gram — Telegram Promotion Platform" },
      {
        name: "description",
        content:
          "Cool Gram: earn CG coins by completing simple Telegram tasks and spend them promoting your own channel. Advertising without a budget.",
      },
      { property: "og:title", content: "Cool Gram — Telegram Promotion Platform" },
      {
        property: "og:description",
        content: "Earn CG coins with simple tasks and promote your Telegram channel for free.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const steps = [
  { icon: "💰", title: "Earnings", text: "Complete simple tasks and earn CG coins." },
  { icon: "📢", title: "Promote", text: "Use your coins to promote your Telegram channel." },
  { icon: "👤", title: "My Cabinet", text: "Balance, referral link and all activity in one place." },
  { icon: "🎁", title: "Referrals", text: "Get +50 CG bonus for every friend you invite." },
];

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <span className="rounded-full border border-border px-4 py-1 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          Cool Gram
        </span>
        <h1 className="mt-8 text-4xl font-bold tracking-tight sm:text-5xl">
          Advertising without a budget
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground">
          Cool Gram is a Telegram promotion platform. Earn CG coins with simple tasks and spend
          them to promote your own channel.
        </p>
        <a
          href="https://t.me"
          className="mt-10 inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open the bot on Telegram
        </a>

        <div className="mt-20 grid w-full gap-4 text-left sm:grid-cols-2">
          {steps.map((s) => (
            <div key={s.title} className="rounded-xl border border-border bg-card p-6">
              <div className="text-2xl">{s.icon}</div>
              <h2 className="mt-3 text-lg font-semibold text-card-foreground">{s.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
